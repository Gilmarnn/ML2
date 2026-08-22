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
const LIGHT_INDEX_VERSION = 2; // inclui title para busca de anúncios

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
  if (cached && cached.version === LIGHT_INDEX_VERSION && Date.now() - cached.fetchedAt < LIGHT_INDEX_TTL_MS) {
    return cached.items;
  }

  const ids = await mlClient.getUserItemIds(user_id, access_token);
  const items = ids.length > 0 ? await mlClient.getItemsLight(ids, access_token) : [];
  req.session.ml.lightIndex = { items, fetchedAt: Date.now(), version: LIGHT_INDEX_VERSION };
  return items;
}

function applyFilters(items, query) {
  let filtered = items;

  if (query.search) {
    const term = String(query.search).trim().toLowerCase();
    if (term) {
      filtered = filtered.filter((i) =>
        String(i.id || '').toLowerCase().includes(term) ||
        String(i.title || '').toLowerCase().includes(term)
      );
    }
  }

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
// via ?search=&category=&stock=zero|available&listingType=classic|premium&sortBy=most_sold.
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


// Motor de Conversão: cruza visitas + pedidos pagos + competição/preço.
// Não promete causalidade: classifica sinais observáveis para orientar a próxima ação.
router.get('/items/:id/conversion-engine', requireAuth, async (req, res) => {
  try {
    const { access_token, user_id } = req.session.ml;
    const [item] = await mlClient.getItemsDetails([req.params.id], access_token);
    if (!item) return res.status(404).json({ error: 'Anúncio não encontrado.' });

    // Uma janela única de 60 dias permite comparar 30d atuais x 30d anteriores.
    const visits60 = await mlClient.getItemVisits(item.id, access_token, 60).catch(() => null);
    const visitRows = Array.isArray(visits60?.results) ? visits60.results : [];
    const sortedVisits = [...visitRows].sort((a, b) => new Date(a.date) - new Date(b.date));
    const currentVisitRows = sortedVisits.slice(-30);
    const previousVisitRows = sortedVisits.slice(-60, -30);
    const sumVisits = (rows) => rows.reduce((sum, r) => sum + Number(r.total || 0), 0);
    const currentVisits = sumVisits(currentVisitRows);
    const previousVisits = sumVisits(previousVisitRows);

    const now = new Date();
    const from60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const orders = await mlClient.getOrders(user_id, access_token, {
      fromDate: from60.toISOString(),
      toDate: now.toISOString(),
      maxOrders: 1000,
      itemId: item.id
    });

    function aggregateOrders(from, to) {
      let units = 0;
      let revenue = 0;
      let ordersCount = 0;
      for (const order of orders) {
        const date = new Date(order.date_created || order.date_closed || 0);
        if (!(date >= from && date < to)) continue;
        let matched = false;
        for (const oi of order.order_items || []) {
          if (oi.item?.id !== item.id) continue;
          matched = true;
          const q = Number(oi.quantity || 0);
          units += q;
          revenue += Number(oi.unit_price || 0) * q;
        }
        if (matched) ordersCount += 1;
      }
      return { units, revenue: Number(revenue.toFixed(2)), orders: ordersCount };
    }

    const currentSales = aggregateOrders(cutoff30, new Date(now.getTime() + 1000));
    const previousSales = aggregateOrders(from60, cutoff30);
    const conversion = currentVisits > 0 ? (currentSales.units / currentVisits) * 100 : null;
    const previousConversion = previousVisits > 0 ? (previousSales.units / previousVisits) * 100 : null;
    const conversionChange = conversion != null && previousConversion != null && previousConversion > 0
      ? ((conversion - previousConversion) / previousConversion) * 100
      : null;
    const visitsChange = previousVisits > 0 ? ((currentVisits - previousVisits) / previousVisits) * 100 : null;
    const unitsChange = previousSales.units > 0 ? ((currentSales.units - previousSales.units) / previousSales.units) * 100 : null;

    const competition = await mlClient.getPriceToWin(item.id, access_token).catch(() => null);
    const priceToWin = competition?.price_to_win != null ? Number(competition.price_to_win) : null;
    const currentPrice = Number(item.price || 0);
    const priceGapPct = priceToWin && currentPrice > 0
      ? ((currentPrice - priceToWin) / currentPrice) * 100
      : null;

    const signals = [];
    const actions = [];
    let classification = 'OBSERVAR';
    let priority = 'MÉDIA';

    // Regras heurísticas Visium. São sinais de decisão, não benchmarks oficiais do ML.
    if (currentVisits < 20) {
      signals.push('Pouco tráfego para concluir se o anúncio converte bem ou mal.');
      actions.push('Acumule mais visitas antes de fazer mudanças agressivas de preço.');
      classification = 'OBSERVAR';
      priority = 'BAIXA';
    } else if (conversion != null && conversion >= 2.5 && currentVisits < 250) {
      signals.push(`Boa resposta ao tráfego: ${conversion.toFixed(2)} vendas estimadas a cada 100 visitas.`);
      actions.push('Candidato a ganhar mais exposição: teste aumento de tráfego/Ads sem alterar preço de imediato.');
      classification = 'ESCALAR';
      priority = 'ALTA';
    } else if (currentVisits >= 100 && (conversion == null || conversion < 0.8)) {
      signals.push('O anúncio recebe tráfego, mas transforma poucas visitas em vendas.');
      actions.push('Priorize Radar, preço, frete, avaliações e qualidade da oferta antes de comprar mais tráfego.');
      classification = 'OTIMIZAR';
      priority = 'ALTA';
    } else if (conversion != null && conversion >= 1.5) {
      signals.push(`Conversão estimada saudável para este anúncio no período: ${conversion.toFixed(2)}%.`);
      actions.push('Preserve os elementos atuais e monitore preço/competitividade antes de alterações grandes.');
      classification = 'DEFENDER';
      priority = 'MÉDIA';
    } else {
      signals.push('O anúncio tem dados suficientes, mas ainda não apresenta um sinal forte de escala.');
      actions.push('Teste uma melhoria por vez e compare a conversão nos próximos 7–14 dias.');
    }

    if (conversionChange != null && conversionChange <= -30) {
      signals.push(`Conversão caiu ${Math.abs(conversionChange).toFixed(0)}% contra os 30 dias anteriores.`);
      actions.unshift('Investigue primeiro o que mudou: preço, concorrência, frete, avaliações ou estoque.');
      if (classification === 'ESCALAR' || classification === 'DEFENDER') classification = 'OTIMIZAR';
      priority = 'ALTA';
    } else if (conversionChange != null && conversionChange >= 30) {
      signals.push(`Conversão subiu ${conversionChange.toFixed(0)}% contra os 30 dias anteriores.`);
    }

    if (priceGapPct != null && priceGapPct >= 2) {
      signals.push(`O preço para ganhar no catálogo está cerca de ${priceGapPct.toFixed(1)}% abaixo do preço atual.`);
      actions.push('Abra o Radar antes de reduzir preço e valide se a margem continua aceitável.');
    } else if (competition?.status === 'winning' || competition?.status === 'sharing_first_place') {
      signals.push('O anúncio está competitivo no catálogo; preço não parece ser o primeiro gargalo.');
    }

    if (!item.shipping?.free_shipping && currentVisits >= 100 && conversion != null && conversion < 1.5) {
      signals.push('Sem frete grátis em um anúncio com tráfego relevante e conversão moderada/baixa.');
      actions.push('Simule o impacto de frete grátis/benefício logístico antes de reduzir preço.');
    }

    res.json({
      item: {
        id: item.id,
        title: item.title,
        price: currentPrice,
        freeShipping: Boolean(item.shipping?.free_shipping),
        listingTypeId: item.listing_type_id
      },
      current: {
        days: 30,
        visits: currentVisits,
        units: currentSales.units,
        orders: currentSales.orders,
        revenue: currentSales.revenue,
        conversion: conversion == null ? null : Number(conversion.toFixed(2))
      },
      previous: {
        days: 30,
        visits: previousVisits,
        units: previousSales.units,
        orders: previousSales.orders,
        revenue: previousSales.revenue,
        conversion: previousConversion == null ? null : Number(previousConversion.toFixed(2))
      },
      trend: {
        conversionChangePct: conversionChange == null ? null : Number(conversionChange.toFixed(1)),
        visitsChangePct: visitsChange == null ? null : Number(visitsChange.toFixed(1)),
        unitsChangePct: unitsChange == null ? null : Number(unitsChange.toFixed(1))
      },
      competition: {
        status: competition?.status || null,
        priceToWin,
        priceGapPct: priceGapPct == null ? null : Number(priceGapPct.toFixed(1))
      },
      decision: {
        classification,
        priority,
        signals,
        actions: [...new Set(actions)].slice(0, 5),
        note: 'Classificação heurística do Visium baseada em visitas, vendas e competitividade; não é benchmark oficial do Mercado Livre.'
      },
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('[api/items/:id/conversion-engine]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao montar o Motor de Conversão.' });
  }
});

// Voz do Cliente: avaliações reais do produto via API oficial de Reviews.
// É leitura apenas; serve para descobrir satisfação, distribuição de estrelas e
// comentários recentes sem depender de IA.
router.get('/items/:id/reviews', requireAuth, async (req, res) => {
  try {
    const { access_token } = req.session.ml;
    const [item] = await mlClient.getItemsDetails([req.params.id], access_token);
    if (!item) return res.status(404).json({ error: 'Anúncio não encontrado.' });

    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 10));
    let data;
    try {
      data = await mlClient.getItemReviews(item.id, access_token, {
        limit,
        catalogProductId: item.catalog_product_id || null
      });
    } catch (err) {
      if (err.response?.status === 404) {
        data = { paging: { total: 0 }, reviews: [], rating_average: null, rating_levels: {} };
      } else {
        throw err;
      }
    }

    const levels = data.rating_levels || {};
    const distribution = {
      1: Number(levels.one_star || 0),
      2: Number(levels.two_star || 0),
      3: Number(levels.three_star || 0),
      4: Number(levels.four_star || 0),
      5: Number(levels.five_star || 0)
    };
    const ratedTotal = Object.values(distribution).reduce((sum, n) => sum + n, 0);
    const positiveRate = ratedTotal ? Number((((distribution[4] + distribution[5]) / ratedTotal) * 100).toFixed(1)) : null;
    const criticalRate = ratedTotal ? Number((((distribution[1] + distribution[2]) / ratedTotal) * 100).toFixed(1)) : null;

    res.json({
      item: { id: item.id, title: item.title, catalog_product_id: item.catalog_product_id || null },
      summary: {
        total: Number(data.paging?.total || ratedTotal || 0),
        ratingAverage: data.rating_average != null ? Number(data.rating_average) : null,
        distribution,
        positiveRate,
        criticalRate
      },
      reviews: (data.reviews || []).map((review) => ({
        id: review.id,
        rate: Number(review.rate || 0),
        title: review.title || '',
        content: review.content || '',
        likes: Number(review.likes || 0),
        dislikes: Number(review.dislikes || 0),
        dateCreated: review.date_created || null,
        buyingDate: review.buying_date || null,
        mediaCount: Array.isArray(review.media) ? review.media.length : 0,
        variation: (review.attributes_variation || []).map((a) => `${a.attribute_name}: ${a.value_name}`).filter(Boolean)
      }))
    });
  } catch (err) {
    console.error('[api/items/:id/reviews]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao consultar as avaliações deste produto.' });
  }
});


router.post('/items/:id/ads-intelligence', requireAuth, async (req, res) => {
  try {
    const { access_token, user_id } = req.session.ml;
    const [item] = await mlClient.getItemsDetails([req.params.id], access_token);
    if (!item) return res.status(404).json({ error: 'Anúncio não encontrado.' });

    const input = req.body || {};
    const hasCost = input.productCost !== undefined && input.productCost !== null && input.productCost !== '';
    const commission = Number(input.mlCommissionPercent || 0);
    const tax = Number(input.taxPercent || 0);
    const shippingCost = Number(input.shippingCost || 0);
    const fixedFee = Number(input.fixedFee || 0);
    const targetNetMargin = Math.min(30, Math.max(5, Number(input.targetNetMarginPercent || 10)));
    const now = new Date();
    const from30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const isoDate = (d) => d.toISOString().slice(0, 10);

    const [visitsData, orders, competition, advertiser] = await Promise.all([
      mlClient.getItemVisits(item.id, access_token, 30).catch(() => null),
      mlClient.getOrders(user_id, access_token, { fromDate: from30.toISOString(), toDate: now.toISOString(), maxOrders: 300, itemId: item.id }).catch(() => []),
      mlClient.getPriceToWin(item.id, access_token).catch(() => null),
      mlClient.getProductAdsAdvertiser(access_token).catch(() => null)
    ]);

    const visits = Number(visitsData?.total_visits ?? visitsData?.total ?? (Array.isArray(visitsData?.results) ? visitsData.results.reduce((s,r)=>s+Number(r.total||r.visits||0),0) : 0));
    let units=0, revenue=0, orderCount=0;
    for (const order of orders || []) {
      let matched=false;
      for (const oi of order.order_items || []) {
        if (String(oi.item?.id) !== String(item.id)) continue;
        matched=true;
        const q=Number(oi.quantity||0); units += q; revenue += Number(oi.unit_price||0)*q;
      }
      if (matched) orderCount += 1;
    }
    const conversion = visits > 0 ? (units / visits) * 100 : null;
    const currentPrice = Number(item.price || 0);
    const priceToWin = competition?.price_to_win != null ? Number(competition.price_to_win) : null;
    const priceGapPct = priceToWin && currentPrice > 0 ? ((currentPrice-priceToWin)/currentPrice)*100 : null;

    let unitEconomics=null;
    if (hasCost) unitEconomics = calculateMargin({ price:currentPrice, productCost:input.productCost, mlCommissionPercent:commission, shippingCost, fixedFee, taxPercent:tax, adsCostPercent:0 });

    let adGroup=null, adMetrics=null, campaign=null;
    if (advertiser) {
      adGroup = await mlClient.getProductAdsAdGroup(item.id, advertiser, access_token).catch(()=>null);
      if (adGroup?.campaign_id) {
        [adMetrics,campaign] = await Promise.all([
          mlClient.getProductAdsAdGroupMetrics(advertiser.site_id, adGroup.campaign_id, adGroup.id, access_token, {dateFrom:isoDate(from30),dateTo:isoDate(now)}).catch(()=>null),
          mlClient.getProductAdsCampaign(advertiser, adGroup.campaign_id, access_token, {dateFrom:isoDate(from30),dateTo:isoDate(now)}).catch(()=>null)
        ]);
      }
    }

    const preAdsMarginPct = unitEconomics ? Number(unitEconomics.marginPercent||0) : null;
    const availableAdsPct = preAdsMarginPct == null ? null : preAdsMarginPct - targetNetMargin;
    const maxAdsPerSale = availableAdsPct != null && availableAdsPct > 0 ? currentPrice*(availableAdsPct/100) : null;
    const breakEvenRoas = preAdsMarginPct != null && preAdsMarginPct > 0 ? 100/preAdsMarginPct : null;
    const preserveMarginRoas = availableAdsPct != null && availableAdsPct > 0 ? 100/availableAdsPct : null;
    const recommendedRoas = preserveMarginRoas != null ? Math.min(35, Math.max(1,preserveMarginRoas*1.10)) : null;

    const signals=[], actions=[]; let verdict='OBSERVAR', priority='MÉDIA', eligible=false;
    if (!hasCost) { verdict='INFORMAR CUSTO'; priority='ALTA'; signals.push('Sem custo não é possível saber quanto de Ads a margem suporta.'); actions.push('Informe o custo no card antes de definir ROAS ou orçamento.'); }
    else if (Number(item.available_quantity||0) <= 2) { verdict='NÃO INVESTIR'; priority='ALTA'; signals.push('Estoque muito baixo para acelerar tráfego pago.'); actions.push('Reponha estoque antes de aumentar exposição.'); }
    else if (preAdsMarginPct < 15) { verdict='NÃO INVESTIR'; priority='ALTA'; signals.push(`Margem antes de Ads é de apenas ${preAdsMarginPct.toFixed(1)}%.`); actions.push('Revise custo, preço ou comissão antes de adicionar tráfego pago.'); }
    else if (visits >= 100 && conversion != null && conversion < 0.8) { verdict='OTIMIZAR ANTES'; priority='ALTA'; signals.push(`Recebe tráfego, mas converte só ${conversion.toFixed(2)}%.`); actions.push('Corrija oferta/preço/frete antes de pagar por mais visitas.'); }
    else if (priceGapPct != null && priceGapPct >= 8 && competition?.status === 'competing') { verdict='OTIMIZAR ANTES'; priority='ALTA'; signals.push(`Preço está cerca de ${priceGapPct.toFixed(1)}% acima do price_to_win.`); actions.push('Valide competitividade e margem antes de ativar ou escalar Ads.'); }
    else {
      let score=0;
      if (preAdsMarginPct >= 25) score += 2; else if (preAdsMarginPct >= 18) score += 1;
      if (conversion != null && conversion >= 2.5) score += 2; else if (conversion != null && conversion >= 1.5) score += 1;
      if (Number(item.available_quantity||0) >= 8) score += 1;
      if (competition?.status === 'winning' || competition?.status === 'sharing_first_place') score += 1; else if (priceGapPct != null && priceGapPct <= 3) score += 1;
      if (score >= 5) { verdict='APTO PARA ESCALAR'; priority='ALTA'; eligible=true; signals.push('Boa combinação de margem, conversão, estoque e competitividade.'); }
      else if (score >= 3) { verdict='APTO PARA TESTE'; priority='MÉDIA'; eligible=true; signals.push('Há espaço para um teste controlado, mas ainda existem sinais a validar.'); }
      else signals.push('Ainda não há evidência suficiente para escalar mídia com confiança.');
    }

    const campaignMetrics = campaign?.metrics || {};
    const actualRoas = adMetrics?.roas != null ? Number(adMetrics.roas) : null;
    const actualCost = adMetrics?.cost != null ? Number(adMetrics.cost) : null;
    const lostBudget = campaignMetrics.lost_impression_share_by_budget != null ? Number(campaignMetrics.lost_impression_share_by_budget) : null;
    const lostRank = campaignMetrics.lost_impression_share_by_ad_rank != null ? Number(campaignMetrics.lost_impression_share_by_ad_rank) : null;
    if (actualRoas != null && breakEvenRoas != null && actualCost > 0) {
      if (actualRoas < breakEvenRoas) { verdict='REDUZIR / CORRIGIR ADS'; priority='ALTA'; eligible=false; signals.unshift(`ROAS atual (${actualRoas.toFixed(2)}x) está abaixo do equilíbrio (${breakEvenRoas.toFixed(2)}x).`); actions.unshift('Não aumente orçamento; corrija campanha/oferta primeiro.'); }
      else if (recommendedRoas != null && actualRoas >= recommendedRoas*1.2 && lostBudget != null && lostBudget >= 20) { verdict='ESCALAR ORÇAMENTO'; priority='ALTA'; eligible=true; signals.unshift('Ads entrega retorno acima do alvo e perde impressões por orçamento.'); actions.unshift('Aumente orçamento gradualmente e acompanhe ROAS/ACOS.'); }
    }
    if (lostRank != null && lostRank >= 30 && eligible) { signals.push(`Campanha perde ${lostRank.toFixed(1)}% das impressões por Ad Rank.`); actions.push('Teste um ROAS alvo um pouco mais agressivo, sem ultrapassar o limite econômico.'); }
    if (actualRoas == null && eligible) actions.push('Comece com teste controlado e reavalie após dados suficientes de cliques/vendas.');

    const strategy = eligible && recommendedRoas != null ? ((conversion != null && conversion >= 2.5 && preAdsMarginPct >= 25) ? 'INCREASE' : 'PROFITABILITY') : null;
    res.json({
      item:{id:item.id,title:item.title,price:currentPrice,stock:Number(item.available_quantity||0)},
      organic:{visits30d:visits,units30d:units,orders30d:orderCount,revenue30d:Number(revenue.toFixed(2)),conversion:conversion==null?null:Number(conversion.toFixed(2))},
      competition:{status:competition?.status||null,priceToWin,priceGapPct:priceGapPct==null?null:Number(priceGapPct.toFixed(1))},
      economics:unitEconomics?{preAdsMarginPct:Number(preAdsMarginPct.toFixed(2)),netProfitBeforeAds:Number(unitEconomics.netProfit||0),targetNetMarginPct:targetNetMargin,availableAdsPct:availableAdsPct==null?null:Number(availableAdsPct.toFixed(2)),maxAdsPerSale:maxAdsPerSale==null?null:Number(maxAdsPerSale.toFixed(2)),breakEvenRoas:breakEvenRoas==null?null:Number(breakEvenRoas.toFixed(2)),minimumRoasToPreserveTarget:preserveMarginRoas==null?null:Number(preserveMarginRoas.toFixed(2))}:null,
      ads:{enabledForAccount:Boolean(advertiser),activeForItem:Boolean(adGroup?.campaign_id),metrics30d:adMetrics?{clicks:Number(adMetrics.clicks||0),prints:Number(adMetrics.prints||0),cost:Number(adMetrics.cost||0),cpc:Number(adMetrics.cpc||0),ctr:Number(adMetrics.ctr||0),cvr:Number(adMetrics.cvr||0),acos:Number(adMetrics.acos||0),tacos:Number(adMetrics.tacos||0),roas:Number(adMetrics.roas||0),units:Number(adMetrics.units_quantity||0),revenue:Number(adMetrics.total_amount||0)}:null,campaign:campaign?{id:campaign.id,name:campaign.name,status:campaign.status,strategy:campaign.strategy,budget:Number(campaign.budget||0),roasTarget:campaign.roas_target!=null?Number(campaign.roas_target):null,lostByBudget:lostBudget,lostByAdRank:lostRank}:null},
      decision:{verdict,priority,eligible,signals,actions:[...new Set(actions)].slice(0,6)},
      suggestion:eligible && availableAdsPct!=null && availableAdsPct>0?{strategy,roasTarget:recommendedRoas==null?null:Number(recommendedRoas.toFixed(2)),dailyBudgetTest:{from:Number(maxAdsPerSale.toFixed(2)),to:Number((maxAdsPerSale*2).toFixed(2)),basis:'Faixa heurística equivalente a 1–2 vendas/dia do custo máximo de Ads que preserva a margem líquida alvo.'},targetNetMarginPct:targetNetMargin}:null
    });
  } catch (err) {
    console.error('[api/items/:id/ads-intelligence]', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || err.response?.data?.description || 'Falha ao montar a análise de Publicidade.' });
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
