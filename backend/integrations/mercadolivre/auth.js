const axios = require('axios');
const crypto = require('crypto');
const { pool } = require('../../db');

const AUTH_URL = 'https://auth.mercadolivre.com.br/authorization';
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

function ensureConfigured() {
  if (!process.env.ML_CLIENT_ID || !process.env.ML_CLIENT_SECRET || !process.env.ML_REDIRECT_URI) {
    throw new Error('Credenciais do Mercado Livre não configuradas.');
  }
}

function getAuthUrl(req) {
  ensureConfigured();
  const state = crypto.randomBytes(24).toString('hex');
  req.session.marketplaceOAuthState = { value: state, platform: 'mercadolivre', createdAt: Date.now() };
  const params = new URLSearchParams({ response_type: 'code', client_id: process.env.ML_CLIENT_ID, redirect_uri: process.env.ML_REDIRECT_URI, state });
  return `${AUTH_URL}?${params.toString()}`;
}

function validateState(req, state) {
  const saved = req.session.marketplaceOAuthState;
  if (!saved || saved.platform !== 'mercadolivre' || !saved.value || !state || saved.value !== state) {
    throw new Error('Estado OAuth do Mercado Livre inválido. Inicie a conexão novamente.');
  }
  if (Date.now() - Number(saved.createdAt || 0) > 15 * 60 * 1000) {
    throw new Error('Autorização do Mercado Livre expirou. Inicie novamente.');
  }
}

async function handleCallback(req, code, state) {
  ensureConfigured();
  validateState(req, state);
  const response = await axios.post(TOKEN_URL, new URLSearchParams({
    grant_type: 'authorization_code', client_id: process.env.ML_CLIENT_ID,
    client_secret: process.env.ML_CLIENT_SECRET, code, redirect_uri: process.env.ML_REDIRECT_URI
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

  const { access_token, refresh_token, user_id, expires_in } = response.data;
  if (!access_token || !user_id) throw new Error('Mercado Livre não retornou credenciais válidas.');
  const expiresAt = new Date(Date.now() + Number(expires_in || 21600) * 1000);
  let accountName = `Mercado Livre ${user_id}`;
  try {
    const me = await axios.get(`https://api.mercadolibre.com/users/${user_id}`, { headers: { Authorization: `Bearer ${access_token}` } });
    accountName = me.data.nickname || accountName;
  } catch (_) {}

  const result = await pool.query(`
    INSERT INTO marketplace_accounts (user_id,platform,seller_id,account_name,access_token,refresh_token,expires_at,status,updated_at)
    VALUES ($1,'mercadolivre',$2,$3,$4,$5,$6,'active',now())
    ON CONFLICT (user_id,platform,seller_id) DO UPDATE SET
      account_name=EXCLUDED.account_name, access_token=EXCLUDED.access_token,
      refresh_token=EXCLUDED.refresh_token, expires_at=EXCLUDED.expires_at, status='active', updated_at=now()
    RETURNING *`, [req.session.userId, String(user_id), accountName, access_token, refresh_token || null, expiresAt]);
  // Também espelha a conexão na tabela legada. Algumas rotas antigas ainda podem
  // utilizá-la durante a transição para a arquitetura multicanal.
  await pool.query(`
    INSERT INTO ml_connections (user_id,access_token,refresh_token,ml_user_id,expires_at)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (user_id) DO UPDATE SET
      access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token,
      ml_user_id=EXCLUDED.ml_user_id, expires_at=EXCLUDED.expires_at`,
    [req.session.userId, access_token, refresh_token || '', String(user_id), expiresAt.getTime()]);
  delete req.session.marketplaceOAuthState;
  return result.rows[0];
}

async function refreshAccount(account) {
  ensureConfigured();
  if (!account.refresh_token) throw new Error('Conta sem refresh token. Reconecte o Mercado Livre.');
  const response = await axios.post(TOKEN_URL, new URLSearchParams({
    grant_type: 'refresh_token', client_id: process.env.ML_CLIENT_ID,
    client_secret: process.env.ML_CLIENT_SECRET, refresh_token: account.refresh_token
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const expiresAt = new Date(Date.now() + Number(response.data.expires_in || 21600) * 1000);
  const result = await pool.query(`UPDATE marketplace_accounts SET access_token=$1,refresh_token=$2,expires_at=$3,updated_at=now() WHERE id=$4 RETURNING *`,
    [response.data.access_token, response.data.refresh_token || account.refresh_token, expiresAt, account.id]);
  return result.rows[0];
}

module.exports = { getAuthUrl, handleCallback, refreshAccount };
