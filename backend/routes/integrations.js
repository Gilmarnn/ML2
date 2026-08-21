const express = require('express');
const { pool } = require('../db');
const { getAdapter, listPlatforms } = require('../integrations');
const { syncProducts, syncOrders } = require('../services/syncService');

const router = express.Router();

function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login necessário.' });
  next();
}

router.get('/platforms', requireUser, (req, res) => {
  res.json({ platforms: listPlatforms() });
});

router.get('/accounts', requireUser, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, platform, seller_id, account_name, status, expires_at, metadata, created_at, updated_at
      FROM marketplace_accounts WHERE user_id=$1 ORDER BY platform, created_at`, [req.session.userId]);
    res.json({ success: true, accounts: result.rows });
  } catch (error) {
    console.error('[integrations/accounts]', error.message);
    res.status(500).json({ error: 'Falha ao consultar contas conectadas.' });
  }
});

router.get('/connect/:platform', requireUser, (req, res) => {
  try {
    const adapter = getAdapter(req.params.platform);
    if (!adapter) return res.status(404).json({ error: 'Marketplace não suportado.' });
    if (!adapter.isConfigured()) {
      return res.status(503).json({ error: `${adapter.name} ainda não está configurado no servidor. Preencha as credenciais no ambiente do Railway.` });
    }
    if (!adapter.auth?.getAuthUrl) return res.status(501).json({ error: `OAuth de ${adapter.name} indisponível.` });
    return res.redirect(adapter.auth.getAuthUrl(req));
  } catch (err) {
    console.error('[integrations/connect]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/callback/:platform', requireUser, async (req, res) => {
  try {
    const adapter = getAdapter(req.params.platform);
    if (!adapter?.auth?.handleCallback) return res.status(400).send('Plataforma não suportada neste callback.');
    if (req.query.error || req.query.code === 'null') return res.status(400).send(`Autorização não concluída: ${req.query.error || 'acesso negado'}`);
    if (!req.query.code) return res.status(400).send('Código OAuth ausente.');
    const account = await adapter.auth.handleCallback(req, req.query.code, req.query.state);
    return res.redirect(`/dashboard.html?connected=${encodeURIComponent(req.params.platform)}&account=${account.id}`);
  } catch (error) {
    console.error('[integrations/callback]', error.response?.data || error.message);
    return res.status(500).send(`Não foi possível conectar a conta: ${error.message}`);
  }
});

router.post('/accounts/:id/sync', requireUser, async (req, res) => {
  try {
    const ownership = await pool.query('SELECT id FROM marketplace_accounts WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
    if (!ownership.rowCount) return res.status(404).json({ error: 'Conta não encontrada.' });
    const days = Math.min(365, Math.max(1, Number(req.body?.days) || 30));
    const [products, orders] = await Promise.all([
      syncProducts(req.session.userId, req.params.id),
      syncOrders(req.session.userId, req.params.id, { days })
    ]);
    res.json({ ok: true, products, orders });
  } catch (err) {
    console.error('[integrations/sync]', err.response?.data || err.message);
    res.status(500).json({ error: err.message || 'Falha ao sincronizar conta.' });
  }
});

router.get('/accounts/:id/sync-status', requireUser, async (req, res) => {
  const result = await pool.query(`SELECT resource,status,records_count,error_message,started_at,finished_at
    FROM sync_logs WHERE account_id=$1 AND account_id IN (SELECT id FROM marketplace_accounts WHERE user_id=$2)
    ORDER BY started_at DESC LIMIT 10`, [req.params.id, req.session.userId]);
  res.json({ logs: result.rows });
});

router.delete('/accounts/:id', requireUser, async (req, res) => {
  try {
    const result = await pool.query(`UPDATE marketplace_accounts SET status='disconnected', updated_at=now()
      WHERE id=$1 AND user_id=$2 RETURNING id`, [req.params.id, req.session.userId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Conta não encontrada.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao desconectar conta.' });
  }
});

module.exports = router;
