const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      cpf TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cpf TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_cpf_key') THEN
      ALTER TABLE users ADD CONSTRAINT users_cpf_key UNIQUE (cpf);
    END IF;
  END $$`);

  await pool.query(`CREATE TABLE IF NOT EXISTS password_resets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mp_preapproval_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    payer_email TEXT,
    next_payment_date TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payer_email TEXT`);
  await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS next_payment_date TIMESTAMPTZ`);

  // Legado mantido para migração segura de instalações anteriores.
  await pool.query(`CREATE TABLE IF NOT EXISTS ml_connections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    ml_user_id TEXT NOT NULL,
    expires_at BIGINT NOT NULL
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_accounts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    seller_id TEXT NOT NULL,
    account_name TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ,
    refresh_expires_at TIMESTAMPTZ,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, platform, seller_id)
  )`);
  await pool.query(`ALTER TABLE marketplace_accounts ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE marketplace_accounts ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{}'`);
  await pool.query(`ALTER TABLE marketplace_accounts ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketplace_accounts_user_platform ON marketplace_accounts(user_id, platform)`);

  await pool.query(`CREATE TABLE IF NOT EXISTS unified_products (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    platform_product_id TEXT NOT NULL,
    title TEXT NOT NULL,
    price NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'BRL',
    stock INTEGER NOT NULL DEFAULT 0,
    status TEXT,
    thumbnail TEXT,
    sold_quantity INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    profitability_margin NUMERIC(8,2),
    raw_data JSONB,
    last_synced_at TIMESTAMPTZ,
    UNIQUE(account_id, platform_product_id)
  )`);
  await pool.query(`ALTER TABLE unified_products ADD COLUMN IF NOT EXISTS thumbnail TEXT`);
  await pool.query(`ALTER TABLE unified_products ADD COLUMN IF NOT EXISTS sold_quantity INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_unified_products_account ON unified_products(account_id)`);

  await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_orders (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    platform_order_id TEXT NOT NULL,
    status TEXT,
    total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'BRL',
    buyer_id TEXT,
    order_created_at TIMESTAMPTZ,
    order_updated_at TIMESTAMPTZ,
    raw_data JSONB,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(account_id, platform_order_id)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketplace_orders_account_date ON marketplace_orders(account_id, order_created_at DESC)`);

  await pool.query(`CREATE TABLE IF NOT EXISTS sync_logs (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
    resource TEXT NOT NULL,
    status TEXT NOT NULL,
    records_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
  )`);

  await pool.query(`INSERT INTO marketplace_accounts
    (user_id, platform, seller_id, account_name, access_token, refresh_token, expires_at)
    SELECT user_id, 'mercadolivre', ml_user_id, 'Mercado Livre ' || ml_user_id, access_token, refresh_token,
      CASE WHEN expires_at > 200000000000 THEN to_timestamp(expires_at / 1000.0) ELSE to_timestamp(expires_at) END
    FROM ml_connections
    ON CONFLICT (user_id, platform, seller_id) DO NOTHING`);

  await pool.query(`CREATE TABLE IF NOT EXISTS price_races (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    my_item_id TEXT NOT NULL,
    my_item_title TEXT,
    competitor_item_id TEXT NOT NULL,
    competitor_item_title TEXT,
    rule_type TEXT NOT NULL DEFAULT 'amount_below',
    rule_value NUMERIC NOT NULL,
    min_price NUMERIC,
    active BOOLEAN NOT NULL DEFAULT true,
    last_checked_at TIMESTAMPTZ,
    last_competitor_price NUMERIC,
    last_applied_price NUMERIC,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  // Limpeza de tokens de reset já vencidos/consumidos.
  await pool.query(`DELETE FROM password_resets WHERE used=true OR expires_at < now() - interval '1 day'`);
  console.log('[db] Migrations aplicadas.');
}

module.exports = { pool, runMigrations };
