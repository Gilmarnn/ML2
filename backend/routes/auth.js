const express = require('express');
const router = express.Router();

// Proteção simples de acesso à ferramenta em si (antes mesmo do login com o
// Mercado Livre) — pensada para uso individual/pequena equipe, não para um
// sistema multiusuário com cadastro. Usuário e senha vêm de variáveis de
// ambiente, nunca hardcoded no código.
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  const validUser = process.env.ADMIN_USERNAME;
  const validPass = process.env.ADMIN_PASSWORD;

  if (!validUser || !validPass) {
    return res.status(500).json({ error: 'ADMIN_USERNAME/ADMIN_PASSWORD não configurados no servidor.' });
  }

  if (username === validUser && password === validPass) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }

  return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
