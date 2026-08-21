const axios = require('axios');
const crypto = require('crypto');
const { pool } = require('../../db');

const TOKEN_URL = 'https://auth.tiktok-shops.com/api/v2/token/get';
const REFRESH_URL = 'https://auth.tiktok-shops.com/api/v2/token/refresh';

function getAuthorizeBaseUrl() {
  return process.env.TIKTOK_AUTHORIZE_URL || 'https://services.tiktokshop.com/open/authorize';
}

function getAuthUrl(req) {
  if (!process.env.TIKTOK_SERVICE_ID) throw new Error('TIKTOK_SERVICE_ID não configurado.');
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
  const { data } = await axios.get(TOKEN_URL, {
    params: {
      app_key: process.env.TIKTOK_APP_KEY,
      app_secret: process.env.TIKTOK_APP_SECRET,
      auth_code: code,
      grant_type: 'authorized_code'
    }
  });
  if (data.code !== 0 || !data.data?.access_token) {
    throw new Error(data.message || 'TikTok Shop não retornou um access token.');
  }
  return data.data;
}

async function handleCallback(req, code, state) {
  validateState(req, state);
  const token = await exchangeCode(code);
  if (Number(token.user_type) !== 0) {
    throw new Error('A autorização recebida não pertence a uma conta Seller do TikTok Shop.');
  }

  // seller_id/open_id identifica a autorização; a API de lojas preencherá o nome/cipher na sincronização.
  const sellerId = String(token.open_id || token.seller_name || crypto.randomUUID());
  const accessExpiry = token.access_token_expire_in
    ? new Date(Number(token.access_token_expire_in) * 1000)
    : null;
  const refreshExpiry = token.refresh_token_expire_in
    ? new Date(Number(token.refresh_token_expire_in) * 1000)
    : null;

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
      token.granted_scopes || [],
      JSON.stringify({ seller_base_region: token.seller_base_region || null })
    ]);

  delete req.session.marketplaceOAuthState;
  return result.rows[0];
}

async function refreshAccount(account) {
  if (!account.refresh_token) throw new Error('Conta TikTok Shop sem refresh token. Reconecte a conta.');
  const { data } = await axios.get(REFRESH_URL, {
    params: {
      app_key: process.env.TIKTOK_APP_KEY,
      app_secret: process.env.TIKTOK_APP_SECRET,
      refresh_token: account.refresh_token,
      grant_type: 'refresh_token'
    }
  });
  if (data.code !== 0 || !data.data?.access_token) {
    throw new Error(data.message || 'Falha ao renovar token do TikTok Shop.');
  }
  const token = data.data;
  const expiresAt = token.access_token_expire_in ? new Date(Number(token.access_token_expire_in) * 1000) : null;
  const refreshExpiresAt = token.refresh_token_expire_in ? new Date(Number(token.refresh_token_expire_in) * 1000) : account.refresh_expires_at;
  const result = await pool.query(`UPDATE marketplace_accounts
    SET access_token=$1, refresh_token=$2, expires_at=$3, refresh_expires_at=$4, scopes=$5, updated_at=now()
    WHERE id=$6 RETURNING *`, [token.access_token, token.refresh_token || account.refresh_token, expiresAt, refreshExpiresAt, token.granted_scopes || account.scopes || [], account.id]);
  return result.rows[0];
}

module.exports = { getAuthUrl, handleCallback, refreshAccount };
