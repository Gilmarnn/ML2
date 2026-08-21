const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = process.env.SHOPEE_API_BASE_URL || 'https://partner.shopeemobile.com';
function partnerId() { return Number(process.env.SHOPEE_PARTNER_ID); }
function partnerKey() { return process.env.SHOPEE_PARTNER_KEY || ''; }

function sign(path, timestamp, accessToken, shopId) {
  const base = `${partnerId()}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac('sha256', partnerKey()).update(base).digest('hex');
}

async function request(account, { path, params = {} }) {
  const shopId = Number(account.metadata?.shop_id || account.seller_id);
  const timestamp = Math.floor(Date.now() / 1000);
  const common = {
    partner_id: partnerId(),
    timestamp,
    access_token: account.access_token,
    shop_id: shopId,
    sign: sign(path, timestamp, account.access_token, shopId)
  };
  const { data } = await axios.get(`${BASE_URL}${path}`, { params: { ...common, ...params } });
  if (data.error) throw new Error(data.message || data.error);
  return data.response || data;
}

async function getShopInfo(account) {
  return request(account, { path: '/api/v2/shop/get_shop_info' });
}

async function getProducts(account, { pageSize = 100, maxPages = 10 } = {}) {
  const products = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const list = await request(account, {
      path: '/api/v2/product/get_item_list',
      params: { offset, page_size: Math.min(100, pageSize), item_status: 'NORMAL' }
    });
    const ids = (list.item || list.item_list || []).map((x) => x.item_id).filter(Boolean);
    if (!ids.length) break;
    for (let i = 0; i < ids.length; i += 50) {
      const detail = await request(account, {
        path: '/api/v2/product/get_item_base_info',
        params: { item_id_list: ids.slice(i, i + 50).join(',') }
      });
      products.push(...(detail.item_list || detail.item || []));
    }
    if (!list.has_next_page) break;
    offset = Number(list.next_offset ?? offset + ids.length);
  }
  return { products };
}

async function getOrders(account, { fromDate, toDate, pageSize = 100, maxPages = 10 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const requestedFrom = fromDate ? Math.floor(new Date(fromDate).getTime() / 1000) : now - 15 * 86400;
  const requestedTo = toDate ? Math.floor(new Date(toDate).getTime() / 1000) : now;
  const orderSns = new Set();

  // A API de pedidos da Shopee trabalha com janelas curtas. Dividimos períodos
  // maiores para que sincronizações de 30/90 dias não dependam de uma única chamada.
  const MAX_WINDOW_SECONDS = 14 * 86400;
  for (let windowStart = requestedFrom; windowStart <= requestedTo; windowStart += MAX_WINDOW_SECONDS + 1) {
    const windowEnd = Math.min(requestedTo, windowStart + MAX_WINDOW_SECONDS);
    let cursor = '';
    for (let page = 0; page < maxPages; page += 1) {
      const params = {
        time_range_field: 'create_time',
        time_from: windowStart,
        time_to: windowEnd,
        page_size: Math.min(100, pageSize)
      };
      if (cursor) params.cursor = cursor;
      const list = await request(account, { path: '/api/v2/order/get_order_list', params });
      const batch = (list.order_list || []).map((o) => o.order_sn).filter(Boolean);
      batch.forEach((sn) => orderSns.add(sn));
      cursor = list.next_cursor || '';
      if (!list.more || !cursor || !batch.length) break;
    }
  }

  const sns = [...orderSns];
  if (!sns.length) return { orders: [] };
  const orders = [];
  for (let i = 0; i < sns.length; i += 50) {
    const detail = await request(account, {
      path: '/api/v2/order/get_order_detail',
      params: {
        order_sn_list: sns.slice(i, i + 50).join(','),
        response_optional_fields: 'buyer_user_id,buyer_username,total_amount,currency,item_list'
      }
    });
    orders.push(...(detail.order_list || []));
  }
  return { orders };
}

module.exports = { sign, request, getShopInfo, getProducts, getOrders };
