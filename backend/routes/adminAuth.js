const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

const router = express.Router();

// Login do dono da ferramenta (você). Diferente dos assinantes normais,
// esse login não passa pela cobrança do Mercado Pago — na primeira vez que
// alguém loga com ADMIN_USERNAME/ADMIN_PASSWORD certos, criamos uma conta de
// usuário de verdade pra ele (is_admin = true), reaproveitando toda a
// estrutura de usuários/conexão com o ML que os assinantes usam.
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  const validUser = process.env.ADMIN_USERNAME;
  const validPass = process.env.ADMIN_PASSWORD;

  if (!validUser || !validPass) {
    return res.status(500).json({ error: 'ADMIN_USERNAME/ADMIN_PASSWORD não configurados no servidor.' });
  }

  if (username !== validUser || password !== validPass) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }

  try {
    const adminEmail = `${validUser.toLowerCase()}@admin.local`;
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [adminEmail]);

    let userId;
    if (existing.rows.length > 0) {
      userId = existing.rows[0].id;
    } else {
      const passwordHash = await bcrypt.hash(validPass, 10);
      const created = await pool.query(
        'INSERT INTO users (name, email, password_hash, is_admin) VALUES ($1, $2, $3, true) RETURNING id',
        [validUser, adminEmail, passwordHash]
      );
      userId = created.rows[0].id;
      await pool.query('INSERT INTO subscriptions (user_id, status) VALUES ($1, $2)', [userId, 'authorized']);
    }

    req.session.userId = userId;
    req.session.isAdmin = true;
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/login]', err.message);
    res.status(500).json({ error: 'Falha ao entrar. Tente novamente.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
