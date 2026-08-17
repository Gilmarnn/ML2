require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const adminAuthRoutes = require('./routes/adminAuth');

const app = express();
const PORT = process.env.PORT || 3000;

// Validação básica de configuração — falha rápido e com mensagem clara
// em vez de deixar o app subir "quebrado" silenciosamente.
const requiredEnvVars = ['ML_CLIENT_ID', 'ML_CLIENT_SECRET', 'ML_REDIRECT_URI', 'SESSION_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'];
const missing = requiredEnvVars.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `[config] Faltando variáveis de ambiente obrigatórias: ${missing.join(', ')}\n` +
      '[config] Copie .env.example para .env e preencha os valores antes de rodar o servidor.'
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
      // Em produção (https), habilite secure: true
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 6 // 6 horas
    }
  })
);

// Rota de login em si (não pode ficar atrás do próprio gate, senão ninguém
// consegue logar). Tudo mais abaixo dela passa pelo bloqueio.
app.use('/admin', adminAuthRoutes);

// Bloqueia acesso a QUALQUER outra rota (páginas, /auth do Mercado Livre,
// /api) até o usuário logar com usuário/senha configurados no servidor.
const PUBLIC_PATHS = new Set(['/login.html', '/login.js', '/style.css']);
app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (req.session.isAdmin) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Login necessário.' });
  }
  return res.redirect('/login.html');
});

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`[server] Rodando em http://localhost:${PORT}`);
});
