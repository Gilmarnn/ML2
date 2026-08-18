const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

const router = express.Router();

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !isValidEmail(email) || !password || password.length < 8) {
    return res.status(400).json({
      error: 'Preencha nome, um e-mail válido e uma senha com pelo menos 8 caracteres.'
    });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [name, email.toLowerCase(), passwordHash]
    );
    const userId = userResult.rows[0].id;

    // Toda conta nova nasce com assinatura "pending" — só vira "authorized"
    // quando o webhook do Mercado Pago confirmar o pagamento.
    await pool.query('INSERT INTO subscriptions (user_id, status) VALUES ($1, $2)', [userId, 'pending']);

    req.session.userId = userId;
    res.json({ ok: true });
  } catch (err) {
    console.error('[user/register]', err.message);
    res.status(500).json({ error: 'Falha ao criar conta. Tente novamente.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ error: 'Informe e-mail e senha.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, password_hash, is_admin FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    req.session.userId = user.id;
    res.json({ ok: true });
  } catch (err) {
    console.error('[user/login]', err.message);
    res.status(500).json({ error: 'Falha ao entrar. Tente novamente.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
