# Visium Seller 2.0

Plataforma SaaS de análise multicanal para sellers. A base atual mantém todas as funções avançadas do Mercado Livre e adiciona uma arquitetura única para Mercado Livre, TikTok Shop e Shopee, com banco PostgreSQL, assinaturas recorrentes via Mercado Pago e múltiplas contas por usuário.

## O que funciona nesta versão

- Cadastro, login e recuperação de senha de assinantes.
- Login administrativo separado em `/admin-login.html`.
- Assinatura mensal recorrente Mercado Pago via `/preapproval`, com checkout hospedado e confirmação por webhook.
- Sessão persistente em PostgreSQL (`connect-pg-simple`), adequada a reinícios/redeploys no Railway.
- Múltiplas contas por usuário em `marketplace_accounts`.
- OAuth Mercado Livre, com renovação automática de token.
- Mercado Livre: anúncios, categorias, visitas, perguntas/respostas, financeiro, diagnóstico, análise profunda e calculadora.
- Camada multicanal com normalização de produtos e pedidos.
- Cache unificado em `unified_products` e `marketplace_orders`.
- Sincronização manual por conta e histórico em `sync_logs`.
- Dashboard com visão geral consolidada e produtos sincronizados.
- TikTok Shop: OAuth, refresh token, assinatura de requests HMAC-SHA256, lojas autorizadas, produtos e pedidos — ativado quando as credenciais do Partner Center forem configuradas.
- Shopee: autorização, refresh token, assinatura HMAC-SHA256, produtos, pedidos e loja — ativado quando as credenciais do Open Platform forem configuradas.
- Migração não destrutiva das conexões antigas de `ml_connections` para `marketplace_accounts`.

## Estrutura

```text
backend/
  integrations/
    mercadolivre/
    tiktok/
    shopee/
  routes/
    auth.js
    integrations.js
    unified.js
    api.js
    subscription.js
    userAuth.js
    adminAuth.js
  services/
    marketplaceAccounts.js
    normalization.js
    syncService.js
    mercadoPago.js
    diagnostics.js
    costCalculator.js
    ...
public/
  dashboard.html
  dashboard.js
  ...
test/
```

## Variáveis no Railway

Copie os nomes de `.env.example` para `Variables` no Railway. Nunca envie seu `.env` real ao GitHub.

### Obrigatórias

- `NODE_ENV=production`
- `APP_URL=https://SEU-DOMINIO`
- `DATABASE_URL` (Railway PostgreSQL)
- `SESSION_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

### Mercado Livre

- `ML_CLIENT_ID`
- `ML_CLIENT_SECRET`
- `ML_REDIRECT_URI=https://SEU-DOMINIO/auth/callback`

A URL precisa ser idêntica à cadastrada no app do Mercado Livre.

### Mercado Pago

- `MP_ACCESS_TOKEN`
- `SUBSCRIPTION_PRICE_BRL`
- `SUBSCRIPTION_REASON`
- `MP_MOCK_MODE=false` em produção

Webhook no Mercado Pago:

```text
https://SEU-DOMINIO/subscription/webhook
```

### TikTok Shop

- `TIKTOK_APP_KEY`
- `TIKTOK_APP_SECRET`
- `TIKTOK_SERVICE_ID`
- `TIKTOK_REDIRECT_URI=https://SEU-DOMINIO/integrations/callback/tiktok`

Também configure essa Redirect URL no TikTok Shop Partner Center e habilite os scopes necessários de Seller/Product/Order. Enquanto as quatro variáveis principais não existirem, o dashboard mostra TikTok Shop como “configurar” e não tenta iniciar OAuth.

### Shopee

- `SHOPEE_PARTNER_ID`
- `SHOPEE_PARTNER_KEY`
- `SHOPEE_REDIRECT_URI=https://SEU-DOMINIO/integrations/callback/shopee`

Configure a mesma URL na Shopee Open Platform. Sem essas credenciais o canal fica desativado no dashboard.

## Banco

As migrations rodam automaticamente na inicialização e criam/atualizam:

- `users`
- `password_resets`
- `subscriptions`
- `marketplace_accounts`
- `unified_products`
- `marketplace_orders`
- `sync_logs`
- `price_races`
- `user_sessions` (pelo session store)

A tabela antiga `ml_connections` é mantida apenas para compatibilidade e seus registros são copiados sem apagar dados.

## Instalação / teste local

```bash
npm install
cp .env.example .env
npm test
npm start
```

Health check:

```text
GET /health
```

## Atualização única no GitHub

Substitua os arquivos do repositório pelos desta versão e faça um único commit/push. O Railway instalará as novas dependências e rodará as migrations no primeiro deploy.

Exemplo:

```bash
git add -A
git commit -m "Visium Seller 2.0 - arquitetura multicanal"
git push
```

Depois do deploy, valide nesta ordem:

1. `/health` retorna `status: ok`.
2. Login de admin e login de assinante.
3. Mercado Pago (se não estiver em mock).
4. Conexão Mercado Livre já existente ou novo OAuth.
5. Dashboard > Visão geral > selecionar a conta > Sincronizar conta ativa.
6. Só então habilite TikTok Shop/Shopee no Railway, após cadastrar e aprovar os apps nas plataformas.

## Importante sobre TikTok Shop e Shopee

O código de integração está implementado, mas nenhuma aplicação consegue acessar dados reais dessas plataformas sem credenciais, scopes e autorizações aprovadas pelos respectivos portais de desenvolvedor. Portanto, a entrega é funcional sem “credenciais fictícias”: Mercado Livre continua operacional, e TikTok/Shopee passam a funcionar quando as credenciais reais forem adicionadas ao ambiente.
