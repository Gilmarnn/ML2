# Diagnóstico ML

Ferramenta que conecta com sua conta do Mercado Livre via OAuth2, lista seus anúncios,
gera um diagnóstico de qualidade (título, imagens, frete, estoque, visitas) e calcula
margem/custo real por produto.

## O que já funciona
- Login de acesso à própria ferramenta (usuário/senha), antes de qualquer conexão com o Mercado Livre
- Login OAuth2 com o Mercado Livre (sem senha do ML passando pelo app)
- Listagem de anúncios em cards, com preço, estoque, visitas dos últimos 30 dias, vendas e frete grátis
- Diagnóstico por regras (score 0–100) com explicação de cada ponto perdido
- Sidebar de categorias (suas categorias + tamanho de mercado) e aba de exploração da árvore de categorias inteira do Mercado Livre
- Filtros (estoque, tipo de anúncio) e ordenação por mais vendidos
- Calculadora de margem por anúncio (custo salvo no navegador) e a calculadora avulsa
- **Análise profunda por IA** (botão com ícone de estrela no card): busca concorrentes reais na mesma categoria, analisa a foto principal, e sugere título, pontos de melhoria na descrição, posicionamento de preço e crítica da foto — avisando quando uma mudança é arriscada em anúncios que já tiveram vendas

## O que ainda não está implementado (próximos passos possíveis)
- Métricas de Ads (Product Ads / Brand Ads: impressões, cliques, CTR, ACOS) — a API existe
  e o `mlClient.js` pode ser estendido, mas exige que o vendedor tenha o produto de Ads
  habilitado na conta (`advertiser_id` próprio)
- Cache/banco de dados (hoje a lista é buscada em tempo real a cada carregamento, com um
  índice leve cacheado por 10 minutos na sessão — ok para dezenas/centenas de anúncios,
  mas para catálogos muito grandes vale um banco de dados de verdade)
- Multiusuário/SaaS de verdade (hoje é um único usuário/senha de admin definido nas
  variáveis de ambiente; pra virar produto vendável precisa de banco de usuários, cobrança, etc.)
- Alertas via WhatsApp/Telegram
- Aplicar as sugestões da IA diretamente no Mercado Livre (hoje é só leitura/sugestão —
  a edição em si você faz manualmente no ML, o que é mais seguro dado que algumas mudanças
  têm restrição para anúncios com vendas)

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
Abra o `.env` e preencha `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`, `SESSION_SECRET`,
e também `ADMIN_USERNAME`/`ADMIN_PASSWORD` (usuário e senha pra acessar a ferramenta em si —
escolha algo forte, é a única proteção antes de alguém conseguir tentar conectar uma conta
do Mercado Livre pelo seu app). `ANTHROPIC_API_KEY` é obrigatória se você quiser usar o botão
de análise profunda por IA; sem ela, o resto do app funciona normalmente, só esse botão mostra
um aviso. Crie a chave em https://console.anthropic.com (isso é separado da sua assinatura do Claude.ai).

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

## Assinatura de pagantes (cadastro + Mercado Pago) — novidade

Agora a ferramenta tem dois tipos de acesso:
- **Admin** (você): entra em `/admin-login.html` com `ADMIN_USERNAME`/`ADMIN_PASSWORD`, sem precisar pagar assinatura.
- **Assinantes**: se cadastram em `/register.html`, pagam uma assinatura mensal recorrente via Mercado Pago, e o acesso é liberado automaticamente quando o pagamento é confirmado (webhook).

### Passos extras de configuração

1. **Banco de dados**: no Railway, dentro do mesmo projeto, clique em "New" -> "Database" -> "Add PostgreSQL". Isso cria a variavel `DATABASE_URL` automaticamente no ambiente — nao precisa copiar nada manualmente.
2. **Mercado Pago**: crie/entre numa conta em https://www.mercadopago.com.br/developers/panel, pegue o **Access Token** (comece pelo de teste, `TEST-...`, antes de usar o de producao) e configure como `MP_ACCESS_TOKEN`.
3. **Webhook**: no painel de desenvolvedores do Mercado Pago, configure a URL de notificacoes (webhook) apontando para `https://seu-dominio/subscription/webhook`. Isso e o que libera o acesso automaticamente apos o pagamento.
4. **Preco**: ajuste `SUBSCRIPTION_PRICE_BRL` (ex: `49.90`) conforme o valor da sua assinatura.

### Fluxo completo
1. Usuario se cadastra em `/register.html` -> conta criada com assinatura "pending"
2. Vai automaticamente pra `/subscribe.html` -> clica em "Assinar agora" -> e redirecionado pro checkout do Mercado Pago
3. Preenche o cartao la (ambiente deles, seguro) -> Mercado Pago manda um webhook pro nosso `/subscription/webhook`
4. O webhook confirma o status direto na API do Mercado Pago (nao confia so no conteudo da notificacao) e atualiza o banco
5. Proxima vez que o usuario acessa qualquer pagina, o gate de assinatura ja libera o dashboard

### Limitacoes dessa primeira versao
- Sem e-mail de confirmacao de cadastro, nem "esqueci minha senha"
- Sem pagina de "gerenciar assinatura" (cancelar, trocar cartao) — hoje isso so e possivel direto no painel do Mercado Pago do assinante
- Sem validacao de assinatura HMAC do webhook — o app confia no `preapproval_id` recebido e busca a verdade direto na API do MP com nosso proprio token (evita fraude na pratica, mas nao e o nivel mais robusto de seguranca)
