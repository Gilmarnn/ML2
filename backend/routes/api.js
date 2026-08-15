const express = require('express');
const { requireAuth } = require('./auth');
const mlClient = require('../services/mlClient');
const { diagnoseItem } = require('../services/diagnostics');
const { calculateMargin } = require('../services/costCalculator');

const router = express.Router();

const MAX_ITEMS_PER_PAGE = 30;
const CONCURRENCY = 4;

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

// Lista os anúncios do usuário logado, já com visitas dos últimos 30 dias
// e diagnóstico calculado. Suporta paginação via ?offset=&limit= (limit máximo
// de 30 por página) e processa no máximo 4 anúncios em paralelo por vez —
// contas com 100+ anúncios travavam o navegador antes dessa mudança.
router.get('/items', requireAuth, async (req, res) => {
  try {
    const { access_token, user_id } = req.session.ml;
    const ids = await mlClient.getUserItemIds(user_id, access_token);

    if (ids.length === 0) {
      return res.json({ items: [], total: 0, offset: 0, limit: MAX_ITEMS_PER_PAGE });
    }

    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(MAX_ITEMS_PER_PAGE, parseInt(req.query.limit, 10) || MAX_ITEMS_PER_PAGE);
    const pageIds = ids.slice(offset, offset + limit);

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
        permalink: item.permalink,
        thumbnail: item.thumbnail,
        visits: visits?.total_visits ?? null,
        diagnosis
      };
    });

    res.json({ items: enriched, total: ids.length, offset, limit });
  } catch (err) {
    console.error('[api/items]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao buscar anúncios do Mercado Livre.' });
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
