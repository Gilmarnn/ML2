const express = require('express');
const { requireAuth } = require('./auth');
const mlClient = require('../services/mlClient');
const { diagnoseItem } = require('../services/diagnostics');
const { calculateMargin } = require('../services/costCalculator');
const { searchCompetitors } = require('../services/competitorSearch');
const { deepAnalysis } = require('../services/aiAnalysis');

const router = express.Router();

const MAX_ITEMS_PER_PAGE = 30;
const CONCURRENCY = 4;
const LIGHT_INDEX_TTL_MS = 10 * 60 * 1000; // 10 minutos

/**
 * Roda uma função assíncrona sobre uma lista, mas no máximo `concurrency`
 * chamadas em paralelo por vez — em vez de disparar tudo de uma vez com
 * Promise.all(items.map(...)), que trava o navegador e estoura limite de
 * chamadas simultâneas na API do Mercado Livre quando há muitos anúncios.
 */
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/**
 * Busca (ou reaproveita do cache da sessão) a lista "leve" de todos os anúncios
 * do usuário — só os campos usados para filtrar/ordenar/montar a barra de
 * categorias. Evita rebuscar isso a cada mudança de filtro.
 */
async function getLightIndex(req) {
  const { access_token, user_id } = req.session.ml;
  const cached = req.session.ml.lightIndex;
  if (cached && Date.now() - cached.fetchedAt < LIGHT_INDEX_TTL_MS) {
    return cached.items;
  }

  const ids = await mlClient.getUserItemIds(user_id, access_token);
  const items = ids.length > 0 ? await mlClient.getItemsLight(ids, access_token) : [];
  req.session.ml.lightIndex = { items, fetchedAt: Date.now() };
  return items;
}

function applyFilters(items, query) {
  let filtered = items;

  if (query.category) {
    filtered = filtered.filter((i) => i.category_id === query.category);
  }

  if (query.stock === 'zero') {
    filtered = filtered.filter((i) => i.available_quantity === 0);
  } else if (query.stock === 'available') {
    filtered = filtered.filter((i) => i.available_quantity > 0);
  }

  if (query.listingType === 'premium') {
    filtered = filtered.filter((i) => i.listing_type_id === 'gold_pro' || i.listing_type_id === 'gold_premium');
  } else if (query.listingType === 'classic') {
    filtered = filtered.filter((i) => i.listing_type_id === 'gold_special' || i.listing_type_id === 'silver' || i.listing_type_id === 'bronze');
  }

  if (query.sortBy === 'most_sold') {
    filtered = [...filtered].sort((a, b) => (b.sold_quantity || 0) - (a.sold_quantity || 0));
  }

  return filtered;
}

// Lista os anúncios do usuário logado, já com visitas dos últimos 30 dias
// e diagnóstico calculado. Suporta paginação via ?offset=&limit=, e filtros
// via ?category=&stock=zero|available&listingType=classic|premium&sortBy=most_sold.
router.get('/items', requireAuth, async (req, res) => {
  try {
    const { access_token } = req.session.ml;
    const lightIndex = await getLightIndex(req);
    const filtered = applyFilters(lightIndex, req.query);

    if (filtered.length === 0) {
      return res.json({ items: [], total: 0, offset: 0, limit: MAX_ITEMS_PER_PAGE });
    }

    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(MAX_ITEMS_PER_PAGE, parseInt(req.query.limit, 10) || MAX_ITEMS_PER_PAGE);
    const pageIds = filtered.slice(offset, offset + limit).map((i) => i.id);

    const items = await mlClient.getItemsDetails(pageIds, access_token);

    const enriched = await mapWithConcurrency(items, CONCURRENCY, async (item) => {
      let visits = null;
      try {
        visits = await mlClient.getItemVisits(item.id, access_token, 30);
      } catch (e) {
        // Alguns tipos de anúncio/categoria não retornam visitas — não deve derrubar a lista toda
        visits = null;
      }
      const diagnosis = await diagnoseItem(item, visits);
      return {
        id: item.id,
        title: item.title,
        price: item.price,
        available_quantity: item.available_quantity,
        sold_quantity: item.sold_quantity,
        permalink: item.permalink,
        thumbnail: item.thumbnail,
        free_shipping: item.shipping?.free_shipping ?? false,
        listing_type_id: item.listing_type_id,
        visits: visits?.total_visits ?? null,
        diagnosis
      };
    });

    res.json({ items: enriched, total: filtered.length, offset, limit });
  } catch (err) {
    console.error('[api/items]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao buscar anúncios do Mercado Livre.' });
  }
});

// Lista as categorias presentes nos anúncios do usuário, com contagem e o
// tamanho de mercado (total de produtos cadastrados nessa categoria em todo
// o Mercado Livre) — usada para montar o menu lateral de navegação.
router.get('/categories', requireAuth, async (req, res) => {
  try {
    const { access_token } = req.session.ml;
    const lightIndex = await getLightIndex(req);

    const counts = new Map();
    for (const item of lightIndex) {
      counts.set(item.category_id, (counts.get(item.category_id) || 0) + 1);
    }

    const categories = await Promise.all(
      Array.from(counts.entries()).map(async ([categoryId, count]) => {
        const detail = await mlClient.getCategoryDetail(categoryId, access_token).catch(() => null);
        return {
          id: categoryId,
          name: detail?.name ?? categoryId,
          count,
          marketSize: detail?.total_items_in_this_category ?? null
        };
      })
    );

    categories.sort((a, b) => b.count - a.count);

    res.json({ categories, total: lightIndex.length });
  } catch (err) {
    console.error('[api/categories]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao buscar categorias.' });
  }
});

const EXPLORE_CONCURRENCY = 6;

// Navegação livre pela árvore de categorias do Mercado Livre inteiro (não
// só os anúncios do usuário) — usada para descobrir nichos por tamanho de
// mercado. Sem ?parent= devolve as categorias de topo; com ?parent=<id>
// devolve os detalhes dessa categoria e suas subcategorias diretas, cada
// uma com o percentual que representa dentro da categoria pai.
router.get('/explore/categories', requireAuth, async (req, res) => {
  try {
    const { access_token } = req.session.ml;
    const parentId = req.query.parent;

    if (!parentId) {
      const roots = await mlClient.getSiteCategories(access_token);
      const withTotals = await mapWithConcurrency(roots, EXPLORE_CONCURRENCY, async (cat) => {
        const detail = await mlClient.getCategoryDetail(cat.id, access_token).catch(() => null);
        return {
          id: cat.id,
          name: cat.name,
          total: detail?.total_items_in_this_category ?? null,
          representation: null
        };
      });
      return res.json({ current: null, breadcrumb: [], children: withTotals });
    }

    const parent = await mlClient.getCategoryDetail(parentId, access_token);
    const children = await mapWithConcurrency(parent.children_categories, EXPLORE_CONCURRENCY, async (cat) => {
      const detail = await mlClient.getCategoryDetail(cat.id, access_token).catch(() => null);
      const total = detail?.total_items_in_this_category ?? null;
      const representation =
        total !== null && parent.total_items_in_this_category
          ? Number(((total / parent.total_items_in_this_category) * 100).toFixed(1))
          : null;
      return { id: cat.id, name: cat.name, total, representation };
    });

    res.json({
      current: { id: parent.id, name: parent.name, total: parent.total_items_in_this_category },
      breadcrumb: parent.path_from_root,
      children
    });
  } catch (err) {
    console.error('[api/explore/categories]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao buscar categorias do Mercado Livre.' });
  }
});

// Perguntas pendentes de resposta nos anúncios — responder rápido é um dos
// fatores que mais pesa na conversão, então isso mora bem no coração do
// diagnóstico, não é só um "extra".
router.get('/questions', requireAuth, async (req, res) => {
  try {
    const { access_token, user_id } = req.session.ml;
    const questions = await mlClient.getUnansweredQuestions(user_id, access_token);

    if (questions.length === 0) {
      return res.json({ questions: [] });
    }

    const itemIds = [...new Set(questions.map((q) => q.item_id))];
    const items = await mlClient.getItemsDetails(itemIds, access_token).catch(() => []);
    const itemById = new Map(items.map((i) => [i.id, i]));

    const enriched = questions.map((q) => ({
      id: q.id,
      text: q.text,
      dateCreated: q.date_created,
      itemId: q.item_id,
      itemTitle: itemById.get(q.item_id)?.title ?? q.item_id,
      itemThumbnail: itemById.get(q.item_id)?.thumbnail ?? null
    }));

    res.json({ questions: enriched });
  } catch (err) {
    console.error('[api/questions]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao buscar perguntas do Mercado Livre.' });
  }
});

router.post('/questions/:id/answer', requireAuth, async (req, res) => {
  try {
    const { access_token } = req.session.ml;
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Escreva uma resposta antes de enviar.' });
    }
    const result = await mlClient.answerQuestion(req.params.id, text.trim(), access_token);
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[api/questions/:id/answer]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao enviar a resposta ao Mercado Livre.' });
  }
});

// Financeiro: faturamento real (via pedidos pagos), não confundir com
// "sold_quantity" do item (que é total histórico, não fatiado por período).
router.get('/financials', requireAuth, async (req, res) => {
  try {
    const { access_token, user_id } = req.session.ml;
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));

    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);

    const orders = await mlClient.getOrders(user_id, access_token, {
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString()
    });

    const totalRevenue = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
    const orderCount = orders.length;
    const averageTicket = orderCount > 0 ? totalRevenue / orderCount : 0;

    // Receita por item, pra achar os mais rentáveis no período (não
    // necessariamente os que mais vendem em quantidade).
    const revenueByItem = new Map();
    for (const order of orders) {
      for (const item of order.order_items || []) {
        const id = item.item?.id;
        const title = item.item?.title || id;
        const lineTotal = (item.unit_price || 0) * (item.quantity || 0);
        if (!id) continue;
        const current = revenueByItem.get(id) || { title, revenue: 0, units: 0 };
        current.revenue += lineTotal;
        current.units += item.quantity || 0;
        revenueByItem.set(id, current);
      }
    }

    const topItems = Array.from(revenueByItem.entries())
      .map(([id, v]) => ({ id, title: v.title, revenue: Number(v.revenue.toFixed(2)), units: v.units }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    res.json({
      days,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      orderCount,
      averageTicket: Number(averageTicket.toFixed(2)),
      topItems
    });
  } catch (err) {
    console.error('[api/financials]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao buscar dados financeiros do Mercado Livre.' });
  }
});

// Radar de concorrência: combina o dado oficial de competição em catálogo
// (price_to_win/status/boosts) com uma amostra de anúncios similares da busca.
// Recebe custos do frontend apenas para simular margem; não altera preço no ML.
router.post('/items/:id/competition-radar', requireAuth, async (req, res) => {
  try {
    const { access_token } = req.session.ml;
    const [item] = await mlClient.getItemsDetails([req.params.id], access_token);

    if (!item) return res.status(404).json({ error: 'Anúncio não encontrado.' });

    const [officialCompetition, market] = await Promise.all([
      mlClient.getPriceToWin(item.id, access_token).catch(() => null),
      searchCompetitors(item.category_id, item.title, item.id, 8).catch(() => ({
        competitors: [], avgPrice: null, medianPrice: null, minPrice: null,
        maxPrice: null, freeShippingRate: null
      }))
    ]);

    const currentPrice = Number(item.price || officialCompetition?.current_price || 0);
    const officialPriceToWin = officialCompetition?.price_to_win != null
      ? Number(officialCompetition.price_to_win)
      : null;

    const marketPrices = market.competitors.map((c) => Number(c.price || 0)).filter((p) => p > 0);
    const cheaperCount = marketPrices.filter((p) => p < currentPrice).length;
    const sameOrHigherCount = marketPrices.filter((p) => p >= currentPrice).length;
    const marketPosition = marketPrices.length
      ? Math.round((marketPrices.filter((p) => p <= currentPrice).length / marketPrices.length) * 100)
      : null;

    const input = req.body || {};
    const hasCost = input.productCost !== undefined && input.productCost !== null && input.productCost !== '';
    let currentMargin = null;
    let winMargin = null;

    if (hasCost) {
      const common = {
        productCost: input.productCost,
        mlCommissionPercent: input.mlCommissionPercent || 0,
        shippingCost: input.shippingCost || 0,
        fixedFee: input.fixedFee || 0,
        taxPercent: input.taxPercent || 0,
        adsCostPercent: input.adsCostPercent || 0
      };
      currentMargin = calculateMargin({ ...common, price: currentPrice });
      if (officialPriceToWin && officialPriceToWin > 0) {
        winMargin = calculateMargin({ ...common, price: officialPriceToWin });
      }
    }

    const boosts = (officialCompetition?.boosts || []).map((b) => ({
      id: b.id,
      status: b.status,
      description: b.description
    }));

    res.json({
      item: {
        id: item.id,
        title: item.title,
        price: currentPrice,
        currency_id: item.currency_id || 'BRL',
        category_id: item.category_id,
        catalog_listing: Boolean(item.catalog_listing),
        catalog_product_id: item.catalog_product_id || null,
        free_shipping: Boolean(item.shipping?.free_shipping),
        listing_type_id: item.listing_type_id
      },
      officialCompetition: officialCompetition ? {
        available: true,
        status: officialCompetition.status || null,
        currentPrice: Number(officialCompetition.current_price || currentPrice),
        priceToWin: officialPriceToWin,
        priceDifference: officialPriceToWin != null ? Number((currentPrice - officialPriceToWin).toFixed(2)) : null,
        boosts
      } : {
        available: false,
        status: null,
        currentPrice,
        priceToWin: null,
        priceDifference: null,
        boosts: []
      },
      market: {
        ...market,
        cheaperCount,
        sameOrHigherCount,
        pricePercentile: marketPosition
      },
      margin: {
        current: currentMargin,
        atPriceToWin: winMargin
      },
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('[api/items/:id/competition-radar]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao montar o Radar de Concorrência.' });
  }
});

router.get('/items/:id/diagnosis', requireAuth, async (req, res) => {
  try {
    const { access_token } = req.session.ml;
    const [item] = await mlClient.getItemsDetails([req.params.id], access_token);
    const visits = await mlClient.getItemVisits(req.params.id, access_token, 30).catch(() => null);
    const diagnosis = await diagnoseItem(item, visits);
    res.json({ item, diagnosis });
  } catch (err) {
    console.error('[api/items/:id/diagnosis]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao gerar diagnóstico do anúncio.' });
  }
});

// Calculadora não depende de estar logado — é matemática pura, sem chamada ao ML.
router.post('/calculator', (req, res) => {
  try {
    const result = calculateMargin(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Análise profunda de um anúncio específico: busca a descrição completa,
// procura concorrentes reais na mesma categoria, e manda tudo (com a foto
// principal) pra API da Anthropic pedir sugestões de título, descrição,
// preço e foto — focadas em conversão.
router.get('/items/:id/deep-analysis', requireAuth, async (req, res) => {
  try {
    const { access_token } = req.session.ml;
    const [item] = await mlClient.getItemsDetails([req.params.id], access_token);

    if (!item) {
      return res.status(404).json({ error: 'Anúncio não encontrado.' });
    }

    item.plainDescription = await mlClient.getItemDescription(req.params.id, access_token);

    const competitorData = await searchCompetitors(item.category_id, item.title, item.id).catch(() => ({
      competitors: [],
      avgPrice: null,
      avgPictures: null,
      freeShippingRate: null
    }));

    const result = await deepAnalysis({ item, competitorData });

    res.json({
      itemId: item.id,
      title: item.title,
      competitorData,
      ...result
    });
  } catch (err) {
    console.error('[api/items/:id/deep-analysis]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao gerar análise profunda do anúncio.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const { access_token, user_id } = req.session.ml;
    const user = await mlClient.getUserInfo(user_id, access_token);
    res.json({ id: user.id, nickname: user.nickname, reputation: user.seller_reputation });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao buscar dados do usuário.' });
  }
});

module.exports = router;
