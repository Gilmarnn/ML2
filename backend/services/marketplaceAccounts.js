const { pool } = require('../db');
const { getAdapter } = require('../integrations');

async function getAccountForUser(userId, accountId, platform) {
  const params = [userId];
  let sql = `SELECT * FROM marketplace_accounts WHERE user_id=$1 AND status='active'`;
  if (accountId) {
    params.push(accountId);
    sql += ` AND id=$${params.length}`;
  }
  if (platform) {
    params.push(platform);
    sql += ` AND platform=$${params.length}`;
  }
  sql += ' ORDER BY created_at ASC LIMIT 1';
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

async function refreshAccountIfNeeded(account) {
  if (!account?.expires_at) return account;
  const expiresAt = new Date(account.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || Date.now() < expiresAt - 60_000) return account;
  const adapter = getAdapter(account.platform);
  if (!adapter?.auth?.refreshAccount) return account;
  return adapter.auth.refreshAccount(account);
}

async function resolveAccount(userId, { accountId, platform } = {}) {
  const account = await getAccountForUser(userId, accountId, platform);
  if (!account) return null;
  return refreshAccountIfNeeded(account);
}

module.exports = { getAccountForUser, refreshAccountIfNeeded, resolveAccount };
