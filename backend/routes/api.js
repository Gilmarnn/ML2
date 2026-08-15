const express = require('express');
const { requireAuth } = require('./auth');
const mlClient = require('../services/mlClient');
const { diagnoseItem } = require('../services/diagnostics');
const { calculateMargin } = require('../services/costCalculator');

const router = express.Router();

const MAX_ITEMS_PER_PAGE = 30;
const CONCURRENCY = 4;

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
