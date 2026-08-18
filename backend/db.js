const { Pool } = require('pg');

// O Railway injeta DATABASE_URL automaticamente quando você adiciona o
// plugin de Postgres ao projeto — não precisa configurar host/porta/senha
// na mão.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false
});

/**
 * Cria as tabelas na primeira vez que o app roda (e não faz nada se elas já
 * existirem). Simples de propósito — sem ferramenta de migration externa,
 * porque o schema desse projeto é pequeno e muda pouco.
 */
async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mp_preapproval_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ml_connections (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      ml_user_id TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    );
  `);

  console.log('[db] Migrations aplicadas.');
}

module.exports = { pool, runMigrations };
