const axios = require('axios');
const crypto = require('crypto');
const { pool } = require('../../db');

const TOKEN_URL = 'https://auth.tiktok-shops.com/api/v2/token/get';
const REFRESH_URL = 'https://auth.tiktok-shops.com/api/v2/token/refresh';

function requireConfig() {
  const required = ['TIKTOK_APP_KEY', 'TIKTOK_APP_SECRET', 'TIKTOK_SERVICE_ID'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`TikTok Shop não configurado: ${missing.join(', ')}`);
}

function getAuthorizeBaseUrl() {
  return process.env.TIKTOK_AUTHORIZE_URL || 'https://services.tiktokshop.com/open/authorize';
}

function getAuthUrl(req) {
  requireConfig();
  const state = crypto.randomBytes(24).toString('hex');
  req.session.marketplaceOAuthState = { value: state, platform: 'tiktok', createdAt: Date.now() };
  const params = new URLSearchParams({ service_id: process.env.TIKTOK_SERVICE_ID, state });
  return `${getAuthorizeBaseUrl()}?${params.toString()}`;
}

function validateState(req, state) {
  const saved = req.session.marketplaceOAuthState;
  if (!saved || saved.platform !== 'tiktok' || !saved.value || !state || saved.value !== state) {
    throw new Error('Estado OAuth do TikTok Shop inválido ou expirado.');
  }
  if (Date.now() - Number(saved.createdAt || 0) > 15 * 60 * 1000) {
    throw new Error('Autorização TikTok Shop expirada. Tente conectar novamente.');
  }
}

async function exchangeCode(code) {
  requireConfig();
  const { data } = await axios.get(TOKEN_URL, {
    timeout: 30000,
    params: {
      app_key: process.env.TIKTOK_APP_KEY,
      app_secret: process.env.TIKTOK_APP_SECRET,
      auth_code: code,
      grant_type: 'authorized_code'
    }
  });
  if (Number(data?.code) !== 0 || !data?.data?.access_token) {
    throw new Error(data?.message || 'TikTok Shop não retornou um access token.');
  }
  return data.data;
}

function timestampToDate(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

async function handleCallback(req, code, state) {
  validateState(req, state);
  const token = await exchangeCode(code);

  // TikTok Shop usa user_type=0 para seller access token.
  if (token.user_type !== undefined && Number(token.user_type) !== 0) {
    throw new Error('A autorização recebida não pertence a uma conta Seller do TikTok Shop.');
  }

  const sellerId = String(token.open_id || token.seller_name || crypto.randomUUID());
  const accessExpiry = timestampToDate(token.access_token_expire_in);
  const refreshExpiry = timestampToDate(token.refresh_token_expire_in);
  const scopes = Array.isArray(token.granted_scopes) ? token.granted_scopes : [];

  const result = await pool.query(`
    INSERT INTO marketplace_accounts
      (user_id, platform, seller_id, account_name, access_token, refresh_token, expires_at, refresh_expires_at, scopes, metadata, status, updated_at)
    VALUES ($1,'tiktok',$2,$3,$4,$5,$6,$7,$8,$9,'active',now())
    ON CONFLICT (user_id, platform, seller_id) DO UPDATE SET
      account_name=EXCLUDED.account_name,
      access_token=EXCLUDED.access_token,
      refresh_token=EXCLUDED.refresh_token,
      expires_at=EXCLUDED.expires_at,
      refresh_expires_at=EXCLUDED.refresh_expires_at,
      scopes=EXCLUDED.scopes,
      metadata=marketplace_accounts.metadata || EXCLUDED.metadata,
      status='active', updated_at=now()
    RETURNING *`, [
      req.session.userId,
      sellerId,
      token.seller_name || `TikTok Shop ${sellerId}`,
      token.access_token,
      token.refresh_token || null,
      accessExpiry,
      refreshExpiry,
      scopes,
      JSON.stringify({ seller_base_region: token.seller_base_region || null })
    ]);

  delete req.session.marketplaceOAuthState;
  return result.rows[0];
}

async function refreshAccount(account) {
  requireConfig();
  if (!account.refresh_token) throw new Error('Conta TikTok Shop sem refresh token. Reconecte a conta.');

  const { data } = await axios.get(REFRESH_URL, {
    timeout: 30000,
    params: {
      app_key: process.env.TIKTOK_APP_KEY,
      app_secret: process.env.TIKTOK_APP_SECRET,
      refresh_token: account.refresh_token,
      grant_type: 'refresh_token'
    }
  });
  if (Number(data?.code) !== 0 || !data?.data?.access_token) {
    throw new Error(data?.message || 'Falha ao renovar token do TikTok Shop.');
  }

  const token = data.data;
  const expiresAt = timestampToDate(token.access_token_expire_in);
  const refreshExpiresAt = timestampToDate(token.refresh_token_expire_in) || account.refresh_expires_at;
  const scopes = Array.isArray(token.granted_scopes) ? token.granted_scopes : (account.scopes || []);

  const result = await pool.query(`UPDATE marketplace_accounts
    SET access_token=$1, refresh_token=$2, expires_at=$3, refresh_expires_at=$4, scopes=$5, updated_at=now(), status='active'
    WHERE id=$6 RETURNING *`, [
      token.access_token,
      token.refresh_token || account.refresh_token,
      expiresAt,
      refreshExpiresAt,
      scopes,
      account.id
    ]);
  return result.rows[0];
}

module.exports = { getAuthUrl, handleCallback, refreshAccount, exchangeCode, timestampToDate };
