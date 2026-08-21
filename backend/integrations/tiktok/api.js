const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://open-api.tiktokglobalshop.com';
const API_VERSION = process.env.TIKTOK_API_VERSION || '202309';
const EXCLUDE_SIGN_KEYS = new Set(['access_token', 'sign']);

function serializeBody(body) {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

function generateSign(path, params, body, secret) {
  if (!secret) throw new Error('TIKTOK_APP_SECRET não configurado.');
  const paramString = Object.keys(params || {})
    .filter((key) => !EXCLUDE_SIGN_KEYS.has(key) && params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join('');
  const bodyString = serializeBody(body);
  const signString = `${secret}${path}${paramString}${bodyString}${secret}`;
  return crypto.createHmac('sha256', secret).update(signString).digest('hex');
}

async function request(account, { method = 'GET', path, params = {}, body = null }) {
  if (!process.env.TIKTOK_APP_KEY || !process.env.TIKTOK_APP_SECRET) {
    throw new Error('Credenciais TikTok Shop não configuradas no servidor.');
  }
  if (!account?.access_token) throw new Error('Conta TikTok Shop sem access token. Reconecte a conta.');

  const timestamp = Math.floor(Date.now() / 1000);
  const query = { app_key: process.env.TIKTOK_APP_KEY, timestamp, ...params };
  query.sign = generateSign(path, query, body, process.env.TIKTOK_APP_SECRET);

  const { data } = await axios({
    method,
    url: `${BASE_URL}${path}`,
    params: query,
    data: body,
    timeout: 30000,
    headers: {
      'content-type': 'application/json',
      'x-tts-access-token': account.access_token
    }
  });

  if (Number(data?.code) !== 0) {
    const err = new Error(data?.message || `TikTok Shop API retornou código ${data?.code}`);
    err.tiktokCode = Number(data?.code);
    err.requestId = data?.request_id;
    throw err;
  }
  return data.data || {};
}

async function getAuthorizedShops(account) {
  const data = await request(account, { path: `/authorization/${API_VERSION}/shops` });
  return data?.shops || [];
}

async function ensureShop(account) {
  const meta = account.metadata || {};
  if (meta.shop_cipher) {
    return { shop_cipher: meta.shop_cipher, shop_id: meta.shop_id, shop_name: meta.shop_name };
  }
  const shops = await getAuthorizedShops(account);
  const shop = shops[0];
  if (!shop) throw new Error('Nenhuma loja TikTok Shop autorizada para esta conta.');
  return {
    shop_cipher: shop.cipher || shop.shop_cipher,
    shop_id: String(shop.id || shop.shop_id || ''),
    shop_name: shop.name || shop.shop_name || 'TikTok Shop'
  };
}

async function getProducts(account, { pageSize = 100, maxPages = 20 } = {}) {
  const shop = await ensureShop(account);
  const products = [];
  let pageToken = '';

  for (let page = 0; page < maxPages; page += 1) {
    const params = {
      shop_cipher: shop.shop_cipher,
      page_size: Math.min(100, Math.max(1, Number(pageSize) || 100))
    };
    if (pageToken) params.page_token = pageToken;

    const data = await request(account, {
      method: 'POST',
      path: `/product/${API_VERSION}/products/search`,
      params,
      body: {}
    });
    const batch = data?.products || [];
    products.push(...batch);
    pageToken = data?.next_page_token || '';
    if (!pageToken || !batch.length) break;
  }
  return { products, shop };
}

async function getOrders(account, { fromDate, toDate, pageSize = 100, maxPages = 20 } = {}) {
  const shop = await ensureShop(account);
  const orders = [];
  let pageToken = '';

  for (let page = 0; page < maxPages; page += 1) {
    const params = {
      shop_cipher: shop.shop_cipher,
      page_size: Math.min(100, Math.max(1, Number(pageSize) || 100))
    };
    if (pageToken) params.page_token = pageToken;

    const body = {};
    if (fromDate) body.create_time_ge = Math.floor(new Date(fromDate).getTime() / 1000);
    if (toDate) body.create_time_lt = Math.floor(new Date(toDate).getTime() / 1000);

    const data = await request(account, {
      method: 'POST',
      path: `/order/${API_VERSION}/orders/search`,
      params,
      body
    });
    const batch = data?.orders || [];
    orders.push(...batch);
    pageToken = data?.next_page_token || '';
    if (!pageToken || !batch.length) break;
  }
  return { orders, shop };
}

module.exports = {
  API_VERSION,
  serializeBody,
  generateSign,
  request,
  getAuthorizedShops,
  ensureShop,
  getProducts,
  getOrders
};
