const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://open-api.tiktokglobalshop.com';
const EXCLUDE_SIGN_KEYS = new Set(['access_token', 'sign']);

function generateSign(path, params, body, secret) {
  const paramString = Object.keys(params || {})
    .filter((key) => !EXCLUDE_SIGN_KEYS.has(key) && params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join('');
  let signString = `${path}${paramString}`;
  if (body && Object.keys(body).length) signString += JSON.stringify(body);
  signString = `${secret}${signString}${secret}`;
  return crypto.createHmac('sha256', secret).update(signString).digest('hex');
}

async function request(account, { method = 'GET', path, params = {}, body = null }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const query = { app_key: process.env.TIKTOK_APP_KEY, timestamp, ...params };
  query.sign = generateSign(path, query, body, process.env.TIKTOK_APP_SECRET);
  const { data } = await axios({
    method,
    url: `${BASE_URL}${path}`,
    params: query,
    data: body,
    headers: { 'content-type': 'application/json', 'x-tts-access-token': account.access_token }
  });
  if (data.code !== 0) throw new Error(data.message || `TikTok Shop API retornou código ${data.code}`);
  return data.data;
}

async function getAuthorizedShops(account) {
  const data = await request(account, { path: '/authorization/202309/shops' });
  return data?.shops || [];
}

async function ensureShop(account) {
  const meta = account.metadata || {};
  if (meta.shop_cipher) return { shop_cipher: meta.shop_cipher, shop_id: meta.shop_id, shop_name: meta.shop_name };
  const shops = await getAuthorizedShops(account);
  const shop = shops[0];
  if (!shop) throw new Error('Nenhuma loja TikTok Shop autorizada para esta conta.');
  return {
    shop_cipher: shop.cipher || shop.shop_cipher,
    shop_id: shop.id || shop.shop_id,
    shop_name: shop.name || shop.shop_name
  };
}

async function getProducts(account, { pageSize = 100, maxPages = 10 } = {}) {
  const shop = await ensureShop(account);
  const products = [];
  let pageToken = '';
  for (let page = 0; page < maxPages; page += 1) {
    const params = { shop_cipher: shop.shop_cipher, page_size: Math.min(100, pageSize) };
    if (pageToken) params.page_token = pageToken;
    // Search Products is POST in API v202309.
    const data = await request(account, { method: 'POST', path: '/product/202309/products/search', params, body: {} });
    const batch = data?.products || [];
    products.push(...batch);
    pageToken = data?.next_page_token || '';
    if (!pageToken || !batch.length) break;
  }
  return { products, shop };
}

async function getOrders(account, { fromDate, toDate, pageSize = 100, maxPages = 10 } = {}) {
  const shop = await ensureShop(account);
  const orders = [];
  let pageToken = '';
  for (let page = 0; page < maxPages; page += 1) {
    const params = { shop_cipher: shop.shop_cipher, page_size: Math.min(100, pageSize) };
    if (pageToken) params.page_token = pageToken;
    if (fromDate) params.create_time_ge = Math.floor(new Date(fromDate).getTime() / 1000);
    if (toDate) params.create_time_lt = Math.floor(new Date(toDate).getTime() / 1000);
    const data = await request(account, { path: '/order/202309/orders', params });
    const batch = data?.orders || [];
    orders.push(...batch);
    pageToken = data?.next_page_token || '';
    if (!pageToken || !batch.length) break;
  }
  return { orders, shop };
}

module.exports = { generateSign, request, getAuthorizedShops, getProducts, getOrders };
