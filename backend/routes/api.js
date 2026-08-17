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
    const lightIndex = await getLightIndex(req);

    const counts = new Map();
    for (const item of lightIndex) {
      counts.set(item.category_id, (counts.get(item.category_id) || 0) + 1);
    }

    const categories = await Promise.all(
      Array.from(counts.entries()).map(async ([categoryId, count]) => {
        const detail = await mlClient.getCategoryDetail(categoryId).catch(() => null);
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
    const parentId = req.query.parent;

    if (!parentId) {
      const roots = await mlClient.getSiteCategories();
      const withTotals = await mapWithConcurrency(roots, EXPLORE_CONCURRENCY, async (cat) => {
        const detail = await mlClient.getCategoryDetail(cat.id).catch(() => null);
        return {
          id: cat.id,
          name: cat.name,
          total: detail?.total_items_in_this_category ?? null,
          representation: null
        };
      });
      return res.json({ current: null, breadcrumb: [], children: withTotals });
    }

    const parent = await mlClient.getCategoryDetail(parentId);
    const children = await mapWithConcurrency(parent.children_categories, EXPLORE_CONCURRENCY, async (cat) => {
      const detail = await mlClient.getCategoryDetail(cat.id).catch(() => null);
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
