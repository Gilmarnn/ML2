const { pool } = require('../db');
const { getAdapter } = require('../integrations');
const { normalizeProduct, normalizeOrder } = require('./normalization');
const { resolveAccount } = require('./marketplaceAccounts');

async function startLog(accountId, resource) {
  const result = await pool.query(`INSERT INTO sync_logs(account_id, resource, status) VALUES($1,$2,'running') RETURNING id`, [accountId, resource]);
  return result.rows[0].id;
}
async function endLog(id, status, count = 0, error = null) {
  await pool.query(`UPDATE sync_logs SET status=$1, records_count=$2, error_message=$3, finished_at=now() WHERE id=$4`, [status, count, error, id]);
}

async function saveProducts(account, rawProducts) {
  let count = 0;
  for (const raw of rawProducts) {
    const p = normalizeProduct(account.platform, raw);
    await pool.query(`INSERT INTO unified_products
      (account_id,platform,platform_product_id,title,price,currency,stock,status,thumbnail,sold_quantity,raw_data,last_synced_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
      ON CONFLICT(account_id,platform_product_id) DO UPDATE SET
        title=EXCLUDED.title, price=EXCLUDED.price, currency=EXCLUDED.currency,
        stock=EXCLUDED.stock, status=EXCLUDED.status, thumbnail=EXCLUDED.thumbnail,
        sold_quantity=EXCLUDED.sold_quantity, raw_data=EXCLUDED.raw_data, last_synced_at=now()`,
      [account.id,p.platform,p.platform_product_id,p.title,p.price,p.currency,p.stock,p.status,p.thumbnail,p.sold_quantity,JSON.stringify(p.raw_data)]);
    count += 1;
  }
  return count;
}

async function saveOrders(account, rawOrders) {
  let count = 0;
  for (const raw of rawOrders) {
    const o = normalizeOrder(account.platform, raw);
    await pool.query(`INSERT INTO marketplace_orders
      (account_id,platform,platform_order_id,status,total_amount,currency,buyer_id,order_created_at,order_updated_at,raw_data,last_synced_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
      ON CONFLICT(account_id,platform_order_id) DO UPDATE SET
        status=EXCLUDED.status,total_amount=EXCLUDED.total_amount,currency=EXCLUDED.currency,
        buyer_id=EXCLUDED.buyer_id,order_created_at=EXCLUDED.order_created_at,
        order_updated_at=EXCLUDED.order_updated_at,raw_data=EXCLUDED.raw_data,last_synced_at=now()`,
      [account.id,o.platform,o.platform_order_id,o.status,o.total_amount,o.currency,o.buyer_id,o.order_created_at,o.order_updated_at,JSON.stringify(o.raw_data)]);
    count += 1;
  }
  return count;
}

async function ensureFreshAccount(account, adapter) {
  if (!account?.expires_at || !adapter?.auth?.refreshAccount) return account;
  const expiresAt = new Date(account.expires_at).getTime();
  if (!Number.isFinite(expiresAt)) return account;
  // Renova antes da expiração para que sincronizações longas não morram no meio.
  if (expiresAt - Date.now() <= 10 * 60 * 1000) {
    return adapter.auth.refreshAccount(account);
  }
  return account;
}

async function enrichAccountMetadata(account, extra) {
  if (!extra || !Object.keys(extra).length) return account;
  const result = await pool.query(`UPDATE marketplace_accounts SET metadata=metadata || $1::jsonb,
    account_name=COALESCE($2, account_name), updated_at=now() WHERE id=$3 RETURNING *`,
    [JSON.stringify(extra), extra.shop_name || null, account.id]);
  return result.rows[0];
}

async function syncProducts(userId, accountId) {
  let account = await resolveAccount(userId, { accountId });
  if (!account) throw new Error('Conta de marketplace não encontrada.');
  const adapter = getAdapter(account.platform);
  account = await ensureFreshAccount(account, adapter);
  if (!adapter?.api?.getProducts) throw new Error(`Produtos ainda não são suportados por ${account.platform}.`);
  const logId = await startLog(account.id, 'products');
  try {
    let result;
    if (account.platform === 'mercadolivre') {
      const ids = await adapter.api.getUserItemIds(account.seller_id, account.access_token);
      const products = ids.length ? await adapter.api.getItemsDetails(ids, account.access_token) : [];
      result = { products };
    } else {
      result = await adapter.api.getProducts(account);
    }
    if (result.shop) account = await enrichAccountMetadata(account, result.shop);
    const count = await saveProducts(account, result.products || []);
    await endLog(logId, 'success', count);
    return { accountId: account.id, platform: account.platform, count };
  } catch (err) {
    await endLog(logId, 'error', 0, err.message);
    throw err;
  }
}

async function syncOrders(userId, accountId, { days = 30 } = {}) {
  let account = await resolveAccount(userId, { accountId });
  if (!account) throw new Error('Conta de marketplace não encontrada.');
  const adapter = getAdapter(account.platform);
  account = await ensureFreshAccount(account, adapter);
  if (!adapter?.api?.getOrders) throw new Error(`Pedidos ainda não são suportados por ${account.platform}.`);
  const logId = await startLog(account.id, 'orders');
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - Math.min(365, Math.max(1, Number(days) || 30)) * 86400000);
  try {
    let result;
    if (account.platform === 'mercadolivre') {
      const orders = await adapter.api.getOrders(account.seller_id, account.access_token, { fromDate: fromDate.toISOString(), toDate: toDate.toISOString() });
      result = { orders };
    } else {
      result = await adapter.api.getOrders(account, { fromDate: fromDate.toISOString(), toDate: toDate.toISOString() });
    }
    if (result.shop) account = await enrichAccountMetadata(account, result.shop);
    const count = await saveOrders(account, result.orders || []);
    await endLog(logId, 'success', count);
    return { accountId: account.id, platform: account.platform, count };
  } catch (err) {
    await endLog(logId, 'error', 0, err.message);
    throw err;
  }
}

module.exports = { syncProducts, syncOrders, saveProducts, saveOrders };
