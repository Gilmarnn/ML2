require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Validação básica de configuração — falha rápido e com mensagem clara
// em vez de deixar o app subir "quebrado" silenciosamente.
const requiredEnvVars = ['ML_CLIENT_ID', 'ML_CLIENT_SECRET', 'ML_REDIRECT_URI', 'SESSION_SECRET'];
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

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`[server] Rodando em http://localhost:${PORT}`);
});
