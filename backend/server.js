require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSessionFactory = require('connect-pg-simple');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const { pool, runMigrations } = require('./db');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const unifiedRoutes = require('./routes/unified');
const adminAuthRoutes = require('./routes/adminAuth');
const userAuthRoutes = require('./routes/userAuth');
const subscriptionRoutes = require('./routes/subscription');
const integrationRoutes = require('./routes/integrations');

const app = express();
const PORT = process.env.PORT || 3000;

const required = ['SESSION_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'DATABASE_URL'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`[config] Variáveis obrigatórias ausentes: ${missing.join(', ')}`);
  process.exit(1);
}

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      scriptSrc: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

const PgSession = pgSessionFactory(session);
app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/user/login', authLimiter);
app.use('/user/register', authLimiter);
app.use('/user/forgot-password', authLimiter);
app.use('/admin/login', authLimiter);

app.use('/admin', adminAuthRoutes);
app.use('/user', userAuthRoutes);

const PUBLIC_PATHS = new Set([
  '/login.html','/login.js','/register.html','/register.js','/admin-login.html','/admin-login.js',
  '/forgot-password.html','/forgot-password.js','/reset-password.html','/reset-password.js','/style.css','/health'
]);

app.use((req, res, next) => {
  if (req.path === '/subscription/webhook') return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (req.session.userId) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/integrations/') || req.path.startsWith('/subscription/')) {
    return res.status(401).json({ error: 'Login necessário.' });
  }
  return res.redirect('/login.html');
});

const SUBSCRIPTION_EXEMPT_PATHS = new Set(['/subscribe.html', '/subscribe.js']);
app.use(async (req, res, next) => {
  if (req.path === '/subscription/webhook') return next();
  if (!req.session.userId || req.session.isAdmin) return next();
  if (SUBSCRIPTION_EXEMPT_PATHS.has(req.path) || req.path.startsWith('/subscription/')) return next();
  try {
    const result = await pool.query('SELECT status FROM subscriptions WHERE user_id=$1', [req.session.userId]);
    if (result.rows[0]?.status === 'authorized') return next();
    if (req.path.startsWith('/api/') || req.path.startsWith('/integrations/')) {
      return res.status(402).json({ error: 'Assinatura pendente ou inativa.' });
    }
    return res.redirect('/subscribe.html');
  } catch (err) {
    console.error('[subscription-gate]', err.message);
    return res.status(500).send('Erro ao verificar assinatura.');
  }
});

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api/unified', unifiedRoutes);
app.use('/subscription', subscriptionRoutes);
app.use('/integrations', integrationRoutes);
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', app: 'visium-seller', version: '2.0.0' });
  } catch (_) {
    res.status(503).json({ status: 'degraded', database: 'unavailable' });
  }
});

runMigrations().then(() => {
  app.listen(PORT, () => console.log(`[server] Visium Seller rodando na porta ${PORT}`));
}).catch((err) => {
  console.error('[db] Falha nas migrations:', err);
  process.exit(1);
});
