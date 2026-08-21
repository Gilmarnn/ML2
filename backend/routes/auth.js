const express = require('express');
const axios = require('axios');
const { pool } = require('../db');

const router = express.Router();

const ML_AUTH_URL = 'https://auth.mercadolivre.com.br/authorization';
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

// Passo 1: manda o usuário pra tela de login do Mercado Livre.
router.get('/login', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login.html');
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.ML_CLIENT_ID,
    redirect_uri: process.env.ML_REDIRECT_URI
  });
  res.redirect(`${ML_AUTH_URL}?${params.toString()}`);
});

// Passo 2: troca o code pelo access_token + refresh_token, e salva no banco
// vinculado ao usuário logado no momento (não mais só na sessão do navegador
// — assim a conexão com o Mercado Livre persiste entre dispositivos/sessões).
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`Autorização negada ou falhou: ${error}`);
  }
  if (!code) {
    return res.status(400).send('Código de autorização ausente na resposta do Mercado Livre.');
  }
  if (!req.session.userId) {
    return res.status(401).send('Sessão expirada. Faça login na ferramenta de novo antes de conectar o Mercado Livre.');
  }

  try {
    const response = await axios.post(
      ML_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.ML_CLIENT_ID,
        client_secret: process.env.ML_CLIENT_SECRET,
        code,
        redirect_uri: process.env.ML_REDIRECT_URI
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, user_id, expires_in } = response.data;
    const expiresAt = Date.now() + expires_in * 1000;

    await pool.query(
      `INSERT INTO ml_connections (user_id, access_token, refresh_token, ml_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         access_token = $2, refresh_token = $3, ml_user_id = $4, expires_at = $5`,
      [req.session.userId, access_token, refresh_token, String(user_id), expiresAt]
    );

    // Mantém a nova camada multicanal sincronizada com o fluxo OAuth legado.
    await pool.query(
      `INSERT INTO marketplace_accounts
       (user_id, platform, seller_id, account_name, access_token, refresh_token, expires_at, status, updated_at)
       VALUES ($1, 'mercadolivre', $2, $3, $4, $5, $6, 'active', now())
       ON CONFLICT (user_id, platform, seller_id) DO UPDATE SET
         access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token,
         expires_at=EXCLUDED.expires_at, status='active', updated_at=now()`,
      [req.session.userId, String(user_id), `Mercado Livre ${user_id}`, access_token, refresh_token, new Date(expiresAt)]
    );

    res.redirect('/dashboard.html');
  } catch (err) {
    const details = err.response?.data || err.message;
    console.error('[auth/callback] Falha ao trocar code por token:', details);
    res.status(500).send('Não foi possível concluir o login com o Mercado Livre. Veja os logs do servidor.');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Middleware usado pelas rotas da API.
// Compatibilidade multicanal: prefere a conta ML selecionada em marketplace_accounts
// (via ?accountId=), depois uma conta ML ativa do usuário e, por último, o legado ml_connections.
async function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  try {
    const requestedAccountId = req.query.accountId || req.body?.accountId || null;
    let account = null;

    if (requestedAccountId) {
      const selected = await pool.query(
        `SELECT * FROM marketplace_accounts
         WHERE id=$1 AND user_id=$2 AND platform='mercadolivre' AND status <> 'disconnected'
         LIMIT 1`,
        [requestedAccountId, req.session.userId]
      );
      account = selected.rows[0] || null;
    }

    if (!account) {
      const active = await pool.query(
        `SELECT * FROM marketplace_accounts
         WHERE user_id=$1 AND platform='mercadolivre' AND status <> 'disconnected'
         ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
        [req.session.userId]
      );
      account = active.rows[0] || null;
    }

    if (account) {
      let accessToken = account.access_token;
      let refreshToken = account.refresh_token;
      let expiresAtMs = account.expires_at ? new Date(account.expires_at).getTime() : 0;

      if (!expiresAtMs || Date.now() >= expiresAtMs - 60000) {
        if (!refreshToken) {
          return res.status(401).json({ error: 'Conexão com o Mercado Livre expirada. Reconecte a conta.', needsMlConnection: true });
        }
        const response = await axios.post(
          ML_TOKEN_URL,
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: process.env.ML_CLIENT_ID,
            client_secret: process.env.ML_CLIENT_SECRET,
            refresh_token: refreshToken
          }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        accessToken = response.data.access_token;
        refreshToken = response.data.refresh_token || refreshToken;
        expiresAtMs = Date.now() + Number(response.data.expires_in || 21600) * 1000;
        await pool.query(
          `UPDATE marketplace_accounts SET access_token=$1, refresh_token=$2, expires_at=$3, updated_at=now()
           WHERE id=$4 AND user_id=$5`,
          [accessToken, refreshToken, new Date(expiresAtMs), account.id, req.session.userId]
        );
      }

      req.session.ml = {
        access_token: accessToken,
        refresh_token: refreshToken,
        user_id: account.seller_id,
        expires_at: expiresAtMs,
        account_id: account.id
      };
      return next();
    }

    // Compatibilidade com instalações antigas ainda não migradas.
    const result = await pool.query('SELECT * FROM ml_connections WHERE user_id = $1', [req.session.userId]);
    const conn = result.rows[0];
    if (!conn) {
      return res.status(401).json({ error: 'Conecte sua conta do Mercado Livre primeiro.', needsMlConnection: true });
    }

    if (Date.now() < Number(conn.expires_at) - 60000) {
      req.session.ml = {
        access_token: conn.access_token,
        refresh_token: conn.refresh_token,
        user_id: conn.ml_user_id,
        expires_at: Number(conn.expires_at)
      };
      return next();
    }

    const response = await axios.post(
      ML_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.ML_CLIENT_ID,
        client_secret: process.env.ML_CLIENT_SECRET,
        refresh_token: conn.refresh_token
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    const expiresAt = Date.now() + expires_in * 1000;
    await pool.query(
      'UPDATE ml_connections SET access_token = $1, refresh_token = $2, expires_at = $3 WHERE user_id = $4',
      [access_token, refresh_token, expiresAt, req.session.userId]
    );
    req.session.ml = { access_token, refresh_token, user_id: conn.ml_user_id, expires_at: expiresAt };
    return next();
  } catch (err) {
    console.error('[auth] Falha ao carregar/renovar conexão com o ML:', err.response?.data || err.message);
    return res.status(401).json({ error: 'Sessão com o Mercado Livre expirada. Reconecte a conta.' });
  }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
