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

// Validação básica de configuração — falha rápido e com mensagem clara
// em vez de deixar o app subir "quebrado" silenciosamente.
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
      '[config] Copie .env.example para .env e preencha os valores antes de rodar o servidor.\n' +
      '[config] DATABASE_URL normalmente vem pronto se você adicionou o plugin de Postgres no Railway.'
  );
  process.exit(1);
}

// Necessário porque o Railway (e a maioria dos PaaS) fica atrás de um proxy
// reverso que termina o HTTPS antes de chegar no app. Sem isso, o Express não
// reconhece a conexão como segura e o cookie de sessão (secure: true) não é
// salvo — o usuário fica sendo jogado de volta pra tela de login sempre.
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
      maxAge: 1000 * 60 * 60 * 24 * 30 // 30 dias — assinante não deveria precisar logar toda hora
    }
  })
);

// Rotas de autenticação em si não podem ficar atrás do próprio gate.
app.use('/admin', adminAuthRoutes);
app.use('/user', userAuthRoutes);

const PUBLIC_PATHS = new Set([
  '/login.html',
  '/login.js',
  '/register.html',
  '/register.js',
  '/admin-login.html',
  '/admin-login.js',
  '/style.css'
]);

// Portão 1: precisa estar logado (usuário comum OU admin) pra passar daqui.
// Exceção: o webhook do Mercado Pago é chamado pelo SERVIDOR deles, não por
// um navegador logado — precisa ficar de fora do gate de login também.
app.use((req, res, next) => {
  if (req.path === '/subscription/webhook') return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (req.session.userId) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/subscription/')) {
    return res.status(401).json({ error: 'Login necessário.' });
  }
  return res.redirect('/login.html');
});

// Portão 2: se for assinante comum (não admin) sem assinatura ativa, manda
// pra tela de "assine agora" — exceto nas próprias páginas/rotas de
// assinatura (e o webhook), senão ninguém consegue nem contratar.
const SUBSCRIPTION_EXEMPT_PATHS = new Set(['/subscribe.html', '/subscribe.js']);
app.use(async (req, res, next) => {
  if (req.path === '/subscription/webhook') return next();
  if (req.session.isAdmin) return next();
  if (SUBSCRIPTION_EXEMPT_PATHS.has(req.path)) return next();
  if (req.path.startsWith('/subscription/')) return next();

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

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/subscription', subscriptionRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

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
