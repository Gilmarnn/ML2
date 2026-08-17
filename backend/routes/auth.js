const express = require('express');
const axios = require('axios');

const router = express.Router();

const ML_AUTH_URL = 'https://auth.mercadolivre.com.br/authorization';
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

// Passo 1: manda o usuário pra tela de login do Mercado Livre.
// O usuário loga com a conta dele e autoriza o app a acessar os dados.
router.get('/login', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.ML_CLIENT_ID,
    redirect_uri: process.env.ML_REDIRECT_URI
  });
  res.redirect(`${ML_AUTH_URL}?${params.toString()}`);
});

// Passo 2: o Mercado Livre redireciona de volta pra cá com um "code".
// Trocamos esse code por um access_token + refresh_token.
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`Autorização negada ou falhou: ${error}`);
  }
  if (!code) {
    return res.status(400).send('Código de autorização ausente na resposta do Mercado Livre.');
  }

  try {
    const response = await axios.post(
      ML_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.ML_CLIENT_ID,
        client_secret: process.env.ML_CLIENT_SECRET,
        code,
        redirect_uri: process.env.ML_REDIRECT_URI
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, user_id, expires_in } = response.data;

    req.session.ml = {
      access_token,
      refresh_token,
      user_id,
      expires_at: Date.now() + expires_in * 1000
    };

    res.redirect('/dashboard.html');
  } catch (err) {
    const details = err.response?.data || err.message;
    console.error('[auth/callback] Falha ao trocar code por token:', details);
    res.status(500).send('Não foi possível concluir o login com o Mercado Livre. Veja os logs do servidor.');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Middleware usado pelas rotas da API pra exigir sessão autenticada,
// e renovar o access_token automaticamente quando ele expira (dura ~6h).
async function requireAuth(req, res, next) {
  const ml = req.session.ml;
  if (!ml) {
    return res.status(401).json({ error: 'Não autenticado. Faça login em /auth/login.' });
  }

  if (Date.now() < ml.expires_at - 60000) {
    return next();
  }

  try {
    const response = await axios.post(
      ML_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.ML_CLIENT_ID,
        client_secret: process.env.ML_CLIENT_SECRET,
        refresh_token: ml.refresh_token
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    req.session.ml = {
      ...ml,
      access_token,
      refresh_token,
      expires_at: Date.now() + expires_in * 1000
    };
    next();
  } catch (err) {
    console.error('[auth] Falha ao renovar token:', err.response?.data || err.message);
    res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
