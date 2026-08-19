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
      cpf TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Garante a coluna cpf mesmo em bancos criados antes dessa mudança.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cpf TEXT;`);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_cpf_key') THEN
        ALTER TABLE users ADD CONSTRAINT users_cpf_key UNIQUE (cpf);
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT false,
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
