const express = require('express');
const { requireAuth } = require('./auth');
const mlClient = require('../services/mlClient');
const { diagnoseItem } = require('../services/diagnostics');
const { calculateMargin } = require('../services/costCalculator');

const router = express.Router();

// Lista os anúncios do usuário logado, já com visitas dos últimos 30 dias
// e diagnóstico calculado. Pode ficar lento com muitos anúncios porque faz
// 1 chamada de visitas por item — ok para dezenas, precisa de fila/cache para milhares.
router.get('/items', requireAuth, async (req, res) => {
  try {
    const { access_token, user_id } = req.session.ml;
    const ids = await mlClient.getUserItemIds(user_id, access_token);

    if (ids.length === 0) {
      return res.json({ items: [] });
    }

    const items = await mlClient.getItemsDetails(ids, access_token);

    const enriched = await Promise.all(
      items.map(async (item) => {
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
      })
    );

    res.json({ items: enriched });
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
