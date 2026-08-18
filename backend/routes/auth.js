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

// Middleware usado pelas rotas da API: carrega a conexão do Mercado Livre do
// usuário logado no momento, renovando o token se necessário, e injeta o
// resultado em req.session.ml no mesmo formato de antes — assim o resto do
// código que já lia req.session.ml continua funcionando sem precisar mudar.
async function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  try {
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
    next();
  } catch (err) {
    console.error('[auth] Falha ao carregar/renovar conexão com o ML:', err.response?.data || err.message);
    res.status(401).json({ error: 'Sessão com o Mercado Livre expirada. Reconecte a conta.' });
  }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
