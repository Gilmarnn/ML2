const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProduct, normalizeOrder } = require('../backend/services/normalization');

test('normaliza produto Mercado Livre', () => {
  const p = normalizeProduct('mercadolivre', { id: 'MLB1', title: 'Produto', price: 99.9, currency_id: 'BRL', available_quantity: 7, sold_quantity: 3, status: 'active' });
  assert.equal(p.platform_product_id, 'MLB1');
  assert.equal(p.stock, 7);
  assert.equal(p.sold_quantity, 3);
});

test('normaliza pedido Shopee', () => {
  const o = normalizeOrder('shopee', { order_sn: 'ABC', order_status: 'COMPLETED', total_amount: 120, currency: 'BRL', create_time: 1700000000 });
  assert.equal(o.platform_order_id, 'ABC');
  assert.equal(o.total_amount, 120);
  assert.match(o.order_created_at, /^2023-/);
});

test('normaliza pedido TikTok Shop', () => {
  const o = normalizeOrder('tiktok', { id: 'T1', status: 'COMPLETED', payment: { total_amount: '88.50', currency: 'BRL' } });
  assert.equal(o.platform_order_id, 'T1');
  assert.equal(o.total_amount, 88.5);
});
