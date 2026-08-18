require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const { pool, runMigrations } = require('./db');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const adminAuthRoutes = require('./routes/adminAuth');
const userAuthRoutes = require('./routes/userAuth');
const subscriptionRoutes = require('./routes/subscription');

const app = express();
const PORT = process.env.PORT || 8080;

// 1. Validação de variáveis de ambiente obrigatórias
const requiredEnvVars = [
  'ML_CLIENT_ID',
  'ML_CLIENT_SECRET',
  'ML_REDIRECT_URI',
  'SESSION_SECRET',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  'DATABASE_URL'
];
const missing = requiredEnvVars.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `[config] Faltando variáveis de ambiente obrigatórias: ${missing.join(', ')}\n` +
      '[config] Preencha as variáveis nas configurações do Railway.'
  );
  process.exit(1);
}

// 2. Configurações de Proxy e Middlewares Base
app.set('trust proxy', 1);
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 30 // 30 dias
    }
  })
);

// 3. Servir arquivos estáticos da pasta "público" PRIMEIRO (Evita loops de redirecionamento)
app.use(express.static(path.join(__dirname, 'público')));
app.use(express.static(path.join(__dirname, 'public')));

// 4. Rota de Health Check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 5. Rotas públicas de Autenticação / Webhook
app.use('/admin', adminAuthRoutes);
app.use('/user', userAuthRoutes);
app.use('/auth', authRoutes);

// Listas de arquivos e rotas isentas das travas de login/assinatura
const PUBLIC_PATHS = new Set([
  '/',
  '/login.html',
  '/login.js',
  '/register.html',
  '/register.js',
  '/admin-login.html',
  '/admin-login.js',
  '/estilo.css',
  '/style.css'
]);

const SUBSCRIPTION_EXEMPT_PATHS = new Set([
  '/subscribe.html',
  '/subscribe.js'
]);

// PORTÃO 1: Autenticação (Exige login para rotas/arquivos privados)
app.use((req, res, next) => {
  if (req.path === '/subscription/webhook') return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (req.session && req.session.userId) return next();

  if (req.path.startsWith('/api/') || req.path.startsWith('/subscription/')) {
    return res.status(401).json({ error: 'Login necessário.' });
  }
  return res.redirect('/login.html');
});

// PORTÃO 2: Verificação de Assinatura (Apenas para usuários autenticados)
app.use(async (req, res, next) => {
  if (req.path === '/subscription/webhook') return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (SUBSCRIPTION_EXEMPT_PATHS.has(req.path)) return next();
  if (req.path.startsWith('/subscription/')) return next();
  if (req.session && req.session.isAdmin) return next();

  try {
    const result = await pool.query('SELECT status FROM subscriptions WHERE user_id = $1', [req.session.userId]);
    const status = result.rows[0]?.status;
    if (status === 'authorized') return next();

    if (req.path.startsWith('/api/')) {
      return res.status(402).json({ error: 'Assinatura pendente ou inativa.' });
    }
    return res.redirect('/subscribe.html');
  } catch (err) {
    console.error('[subscription-gate]', err.message);
    return res.status(500).send('Erro ao verificar assinatura.');
  }
});

// 6. Rotas Privadas
app.use('/api', apiRoutes);
app.use('/subscription', subscriptionRoutes);

// 7. Inicialização do Banco de Dados e Servidor
runMigrations()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[servidor] Rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[db] Falha ao rodar migrations:', err.message);
    process.exit(1);
  });