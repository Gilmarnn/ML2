const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db');
const { isValidCPF } = require('../services/validators');
const { sendEmail } = require('../services/email');

const router = express.Router();

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function onlyDigits(str) {
  return String(str || '').replace(/\D/g, '');
}

router.post('/register', async (req, res) => {
  const { name, email, password, cpf } = req.body || {};
  const cleanCpf = onlyDigits(cpf);

  if (!name || !isValidEmail(email) || !password || password.length < 8) {
    return res.status(400).json({
      error: 'Preencha nome, um e-mail válido e uma senha com pelo menos 8 caracteres.'
    });
  }
  if (!isValidCPF(cleanCpf)) {
    return res.status(400).json({ error: 'CPF inválido. Confira os números digitados.' });
  }

  try {
    const existingEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existingEmail.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
    }
    const existingCpf = await pool.query('SELECT id FROM users WHERE cpf = $1', [cleanCpf]);
    if (existingCpf.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe uma conta com esse CPF.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await pool.query(
      'INSERT INTO users (name, email, cpf, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, email.toLowerCase(), cleanCpf, passwordHash]
    );
    const userId = userResult.rows[0].id;

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

// Pede o e-mail, gera um token de uso único válido por 1h, e "envia" o link
// de redefinição (via Resend, ou só no log do servidor em modo de teste).
// Sempre responde ok:true mesmo se o e-mail não existir — não confirma pra
// quem está tentando se um e-mail tem conta ou não (evita vazar essa info).
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Informe um e-mail válido.' });
  }

  try {
    const result = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

      await pool.query(
        'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, token, expiresAt]
      );

      const resetUrl = `${req.protocol}://${req.get('host')}/reset-password.html?token=${token}`;
      await sendEmail({
        to: email,
        subject: 'Redefinir sua senha — Diagnóstico ML',
        html: `<p>Recebemos um pedido para redefinir sua senha.</p>
               <p><a href="${resetUrl}">Clique aqui para criar uma nova senha</a> (válido por 1 hora).</p>
               <p>Se você não pediu isso, pode ignorar este e-mail.</p>`
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[user/forgot-password]', err.message);
    res.status(500).json({ error: 'Falha ao processar o pedido. Tente novamente.' });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};

  if (!token || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Link inválido ou senha muito curta (mínimo 8 caracteres).' });
  }

  try {
    const result = await pool.query(
      'SELECT id, user_id, expires_at, used FROM password_resets WHERE token = $1',
      [token]
    );
    const reset = result.rows[0];

    if (!reset || reset.used || new Date(reset.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Esse link expirou ou já foi usado. Peça um novo.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, reset.user_id]);
    await pool.query('UPDATE password_resets SET used = true WHERE id = $1', [reset.id]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[user/reset-password]', err.message);
    res.status(500).json({ error: 'Falha ao redefinir a senha. Tente novamente.' });
  }
});

module.exports = router;
