const express = require('express');
const { pool } = require('../db');
const router = express.Router();

function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login necessário.' });
  next();
}

router.get('/overview', requireUser, async (req, res) => {
  const platform = req.query.platform && req.query.platform !== 'all' ? req.query.platform : null;
  const accountId = req.query.accountId ? Number(req.query.accountId) : null;
  const params = [req.session.userId];
  let accountWhere = `ma.user_id=$1 AND ma.status='active'`;
  if (platform) { params.push(platform); accountWhere += ` AND ma.platform=$${params.length}`; }
  if (accountId) { params.push(accountId); accountWhere += ` AND ma.id=$${params.length}`; }

  const accounts = await pool.query(`SELECT ma.id,ma.platform,ma.account_name,ma.seller_id,
      count(DISTINCT up.id)::int AS products
    FROM marketplace_accounts ma LEFT JOIN unified_products up ON up.account_id=ma.id
    WHERE ${accountWhere}
    GROUP BY ma.id ORDER BY ma.platform,ma.account_name`, params);

  const orderParams = [...params];
  let orderWhere = accountWhere;
  orderParams.push(new Date(Date.now() - 30 * 86400000));
  const fromIndex = orderParams.length;
  const orders = await pool.query(`SELECT count(mo.id)::int AS order_count,
      coalesce(sum(mo.total_amount),0)::numeric AS revenue,
      coalesce(avg(mo.total_amount),0)::numeric AS average_ticket
    FROM marketplace_orders mo JOIN marketplace_accounts ma ON ma.id=mo.account_id
    WHERE ${orderWhere} AND mo.order_created_at >= $${fromIndex}`, orderParams);

  res.json({
    accounts: accounts.rows,
    last30Days: {
      revenue: Number(orders.rows[0]?.revenue || 0),
      orderCount: Number(orders.rows[0]?.order_count || 0),
      averageTicket: Number(orders.rows[0]?.average_ticket || 0)
    }
  });
});

router.get('/products', requireUser, async (req, res) => {
  const params = [req.session.userId];
  let where = `ma.user_id=$1 AND ma.status='active'`;
  if (req.query.platform && req.query.platform !== 'all') { params.push(req.query.platform); where += ` AND ma.platform=$${params.length}`; }
  if (req.query.accountId) { params.push(Number(req.query.accountId)); where += ` AND ma.id=$${params.length}`; }
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

  const productsResult = await pool.query(`SELECT up.id,up.account_id,up.platform,up.platform_product_id,up.title,up.price,up.currency,up.stock,
      up.status,up.thumbnail,up.sold_quantity,up.score,up.profitability_margin,up.last_synced_at,ma.account_name
    FROM unified_products up JOIN marketplace_accounts ma ON ma.id=up.account_id
    WHERE ${where} ORDER BY up.sold_quantity DESC,up.last_synced_at DESC NULLS LAST`, params);

  // Enriquece produtos do Mercado Livre com desempenho real dos últimos 30 dias.
  // sold_quantity do item é histórico; units_30d/revenue_30d vêm dos pedidos sincronizados.
  const orderParams = [...params, new Date(Date.now() - 30 * 86400000)];
  const fromIndex = orderParams.length;
  const ordersResult = await pool.query(`SELECT mo.platform,mo.raw_data
    FROM marketplace_orders mo JOIN marketplace_accounts ma ON ma.id=mo.account_id
    WHERE ${where} AND mo.order_created_at >= $${fromIndex}`, orderParams);

  const performance = new Map();
  for (const row of ordersResult.rows) {
    const raw = row.raw_data || {};
    if (row.platform === 'mercadolivre') {
      for (const line of raw.order_items || []) {
        const itemId = line.item?.id ? String(line.item.id) : null;
        if (!itemId) continue;
        const current = performance.get(`mercadolivre:${itemId}`) || { units: 0, revenue: 0 };
        current.units += Number(line.quantity || 0);
        current.revenue += Number(line.unit_price || 0) * Number(line.quantity || 0);
        performance.set(`mercadolivre:${itemId}`, current);
      }
    } else if (row.platform === 'tiktok') {
      for (const line of raw.line_items || raw.items || []) {
        const itemId = line.product_id || line.product?.id;
        if (!itemId) continue;
        const current = performance.get(`tiktok:${itemId}`) || { units: 0, revenue: 0 };
        const qty = Number(line.quantity || 1);
        const price = Number(line.sale_price || line.price || 0);
        current.units += qty;
        current.revenue += price * qty;
        performance.set(`tiktok:${itemId}`, current);
      }
    } else if (row.platform === 'shopee') {
      for (const line of raw.item_list || raw.items || []) {
        const itemId = line.item_id || line.id;
        if (!itemId) continue;
        const current = performance.get(`shopee:${itemId}`) || { units: 0, revenue: 0 };
        const qty = Number(line.model_quantity_purchased || line.quantity || 0);
        const price = Number(line.model_discounted_price || line.model_original_price || line.price || 0);
        current.units += qty;
        current.revenue += price * qty;
        performance.set(`shopee:${itemId}`, current);
      }
    }
  }

  const products = productsResult.rows.map((p) => {
    const perf = performance.get(`${p.platform}:${p.platform_product_id}`) || { units: 0, revenue: 0 };
    return {
      ...p,
      units_30d: perf.units,
      revenue_30d: Number(perf.revenue.toFixed(2))
    };
  }).sort((a, b) => (b.revenue_30d - a.revenue_30d) || (b.units_30d - a.units_30d) || (b.sold_quantity - a.sold_quantity));

  res.json({ products: products.slice(0, limit) });
});

router.get('/orders', requireUser, async (req, res) => {
  const params = [req.session.userId];
  let where = `ma.user_id=$1 AND ma.status='active'`;
  if (req.query.platform && req.query.platform !== 'all') { params.push(req.query.platform); where += ` AND ma.platform=$${params.length}`; }
  if (req.query.accountId) { params.push(Number(req.query.accountId)); where += ` AND ma.id=$${params.length}`; }
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  params.push(limit);
  const result = await pool.query(`SELECT mo.id,mo.account_id,mo.platform,mo.platform_order_id,mo.status,mo.total_amount,mo.currency,
      mo.order_created_at,mo.order_updated_at,ma.account_name
    FROM marketplace_orders mo JOIN marketplace_accounts ma ON ma.id=mo.account_id
    WHERE ${where} ORDER BY mo.order_created_at DESC NULLS LAST LIMIT $${params.length}`, params);
  res.json({ orders: result.rows });
});

module.exports = router;
