const axios = require('axios');
const crypto = require('crypto');
const { pool } = require('../../db');

const BASE_URL = process.env.SHOPEE_API_BASE_URL || 'https://partner.shopeemobile.com';

function partnerId() { return Number(process.env.SHOPEE_PARTNER_ID); }
function partnerKey() { return process.env.SHOPEE_PARTNER_KEY || ''; }

function signBase(path, timestamp, accessToken = '', shopId = '') {
  return `${partnerId()}${path}${timestamp}${accessToken || ''}${shopId || ''}`;
}

function sign(path, timestamp, accessToken = '', shopId = '') {
  return crypto.createHmac('sha256', partnerKey()).update(signBase(path, timestamp, accessToken, shopId)).digest('hex');
}

function getAuthUrl(req) {
  const path = '/api/v2/shop/auth_partner';
  const timestamp = Math.floor(Date.now() / 1000);
  const state = crypto.randomBytes(24).toString('hex');
  req.session.marketplaceOAuthState = { value: state, platform: 'shopee', createdAt: Date.now() };
  const redirect = new URL(process.env.SHOPEE_REDIRECT_URI);
  redirect.searchParams.set('state', state);
  const params = new URLSearchParams({
    partner_id: String(partnerId()),
    timestamp: String(timestamp),
    sign: sign(path, timestamp),
    redirect: redirect.toString()
  });
  return `${BASE_URL}${path}?${params.toString()}`;
}

function validateState(req, state) {
  const saved = req.session.marketplaceOAuthState;
  if (!saved || saved.platform !== 'shopee' || !saved.value || !state || saved.value !== state) {
    throw new Error('Estado OAuth da Shopee inválido ou expirado.');
  }
  if (Date.now() - Number(saved.createdAt || 0) > 15 * 60 * 1000) throw new Error('Autorização Shopee expirada.');
}

async function exchangeCode(code, shopId) {
  const path = '/api/v2/auth/token/get';
  const timestamp = Math.floor(Date.now() / 1000);
  const { data } = await axios.post(`${BASE_URL}${path}`, {
    code,
    shop_id: Number(shopId),
    partner_id: partnerId()
  }, { params: { partner_id: partnerId(), timestamp, sign: sign(path, timestamp) } });
  if (data.error || !data.access_token) throw new Error(data.message || data.error || 'Shopee não retornou access token.');
  return data;
}

async function handleCallback(req, code, state) {
  validateState(req, state);
  const shopId = req.query.shop_id || req.query.shopid;
  if (!shopId) throw new Error('A Shopee não retornou shop_id no callback.');
  const token = await exchangeCode(code, shopId);
  const expiresAt = new Date(Date.now() + Number(token.expire_in || 14400) * 1000);
  const result = await pool.query(`
    INSERT INTO marketplace_accounts
      (user_id, platform, seller_id, account_name, access_token, refresh_token, expires_at, metadata, status, updated_at)
    VALUES ($1,'shopee',$2,$3,$4,$5,$6,$7,'active',now())
    ON CONFLICT (user_id, platform, seller_id) DO UPDATE SET
      account_name=EXCLUDED.account_name, access_token=EXCLUDED.access_token,
      refresh_token=EXCLUDED.refresh_token, expires_at=EXCLUDED.expires_at,
      metadata=marketplace_accounts.metadata || EXCLUDED.metadata, status='active', updated_at=now()
    RETURNING *`, [req.session.userId, String(shopId), `Shopee ${shopId}`, token.access_token, token.refresh_token || null, expiresAt, JSON.stringify({ shop_id: Number(shopId) })]);
  delete req.session.marketplaceOAuthState;
  return result.rows[0];
}

async function refreshAccount(account) {
  if (!account.refresh_token) throw new Error('Conta Shopee sem refresh token. Reconecte a conta.');
  const path = '/api/v2/auth/access_token/get';
  const timestamp = Math.floor(Date.now() / 1000);
  const shopId = Number(account.metadata?.shop_id || account.seller_id);
  const { data } = await axios.post(`${BASE_URL}${path}`, {
    refresh_token: account.refresh_token,
    shop_id: shopId,
    partner_id: partnerId()
  }, { params: { partner_id: partnerId(), timestamp, sign: sign(path, timestamp) } });
  if (data.error || !data.access_token) throw new Error(data.message || data.error || 'Falha ao renovar token Shopee.');
  const expiresAt = new Date(Date.now() + Number(data.expire_in || 14400) * 1000);
  const result = await pool.query(`UPDATE marketplace_accounts SET access_token=$1, refresh_token=$2, expires_at=$3, updated_at=now() WHERE id=$4 RETURNING *`, [data.access_token, data.refresh_token || account.refresh_token, expiresAt, account.id]);
  return result.rows[0];
}

module.exports = { getAuthUrl, handleCallback, refreshAccount, sign };
