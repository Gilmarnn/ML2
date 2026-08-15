# Diagnóstico ML

Ferramenta que conecta com sua conta do Mercado Livre via OAuth2, lista seus anúncios,
gera um diagnóstico de qualidade (título, imagens, frete, estoque, visitas) e calcula
margem/custo real por produto.

## O que já funciona
- Login OAuth2 com o Mercado Livre (sem senha passando pelo app)
- Listagem de anúncios com preço, estoque e visitas dos últimos 30 dias
- Diagnóstico por regras (score 0–100) com explicação de cada ponto perdido
- Sugestões em linguagem natural via IA (opcional, precisa de chave da Anthropic)
- Calculadora de margem com taxas que você mesmo informa (não chuta comissão média)

## O que ainda não está implementado (próximos passos possíveis)
- Métricas de Ads (Product Ads / Brand Ads: impressões, cliques, CTR, ACOS) — a API existe
  e o `mlClient.js` pode ser estendido, mas exige que o vendedor tenha o produto de Ads
  habilitado na conta (`advertiser_id` próprio)
- Cache/banco de dados (hoje tudo é buscado em tempo real a cada carregamento — ok para
  poucas dezenas de anúncios, mas para catálogos grandes vale guardar em banco)
- Multiusuário/SaaS de verdade (hoje a sessão é por navegador; pra virar produto vendável
  precisa de banco de usuários, cobrança, etc.)
- Alertas via WhatsApp/Telegram

## Passo a passo pra rodar

### 1. Criar o app no Mercado Livre
1. Acesse https://developers.mercadolivre.com.br e faça login com sua conta ML
2. Crie uma aplicação nova
3. Em "URL de redirect", coloque a mesma URL que você vai usar em `ML_REDIRECT_URI`
   (ex: `http://localhost:3000/auth/callback` pra testar local)
4. Copie o `Client ID` e o `Client Secret` gerados

### 2. Configurar o projeto
```bash
cp .env.example .env
```
Abra o `.env` e preencha `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI` e `SESSION_SECRET`.
`ANTHROPIC_API_KEY` é opcional — sem ela, o diagnóstico funciona normalmente, só sem as
sugestões em texto geradas por IA. Se quiser essa parte, crie uma chave em
https://console.anthropic.com (isso é separado da sua assinatura do Claude.ai).

### 3. Instalar dependências e rodar
```bash
npm install
npm start
```
Acesse `http://localhost:3000`.

### 4. Testar o fluxo
Clique em "Conectar conta do Mercado Livre" → faça login com uma conta de vendedor real →
você será redirecionado pro dashboard com os anúncios daquela conta.

## Deploy (produção)
Qualquer serviço que rode Node.js funciona (Railway, Render, Fly.io). Passos gerais:
1. Suba o código num repositório Git
2. Conecte o repositório no serviço escolhido
3. Configure as mesmas variáveis de ambiente do `.env` no painel do serviço
4. Atualize `ML_REDIRECT_URI` pra apontar pro domínio de produção (ex:
   `https://seudominio.com/auth/callback`)
5. **Importante**: atualize também a URL de redirect cadastrada no app do Mercado Livre
   (passo 1) pra bater exatamente com a de produção — se não bater, o login falha
6. Em produção, `express-session` guarda tudo em memória por padrão, o que **reinicia
   as sessões toda vez que o servidor reinicia/reescala**. Para produção séria, troque
   por um `session store` persistente (ex: `connect-redis`) — isso não está incluso ainda.

## Sobre os dados
- Visitas de anúncio orgânico: disponíveis via API pública do ML (`/items/{id}/visits`)
- Cliques: só existem como métrica separada para anúncios patrocinados via Mercado Ads
  (Product Ads/Brand Ads) — não é possível obter "cliques" de anúncio orgânico porque o
  Mercado Livre não expõe esse dado fora do contexto de Ads
