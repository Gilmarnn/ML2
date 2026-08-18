const express = require('express');
const { pool } = require('../db');
const { createSubscription, getSubscriptionStatus } = require('../services/mercadoPago');

const router = express.Router();

function requireLoggedInUser(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Faça login primeiro.' });
  }
  next();
}

// Cria a assinatura no Mercado Pago e devolve a URL de checkout pro
// front-end redirecionar o usuário.
router.post('/checkout', requireLoggedInUser, async (req, res) => {
  try {
    // Modo de teste: pula o Mercado Pago de verdade e já libera o acesso,
    // simulando um pagamento aprovado na hora. Ative com MP_MOCK_MODE=true
    // no .env para testar o fluxo completo (cadastro -> assinatura -> acesso)
    // sem precisar configurar conta nenhuma no Mercado Pago ainda.
    if (process.env.MP_MOCK_MODE === 'true') {
      await pool.query(
        `INSERT INTO subscriptions (user_id, mp_preapproval_id, status, updated_at)
         VALUES ($1, 'mock', 'authorized', now())
         ON CONFLICT (user_id) DO UPDATE SET status = 'authorized', updated_at = now()`,
        [req.session.userId]
      );
      return res.json({ checkoutUrl: '/dashboard.html' });
    }

    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [req.session.userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const backUrl = `${req.protocol}://${req.get('host')}/subscribe.html`;
    const { preapprovalId, checkoutUrl } = await createSubscription({
      userEmail: user.email,
      userId: req.session.userId,
      backUrl
    });

    await pool.query(
      `INSERT INTO subscriptions (user_id, mp_preapproval_id, status, updated_at)
       VALUES ($1, $2, 'pending', now())
       ON CONFLICT (user_id) DO UPDATE SET mp_preapproval_id = $2, status = 'pending', updated_at = now()`,
      [req.session.userId, preapprovalId]
    );

    res.json({ checkoutUrl });
  } catch (err) {
    console.error('[subscription/checkout]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao iniciar a assinatura. Tente novamente em instantes.' });
  }
});

// Status atual da assinatura do usuário logado — o front-end usa isso pra
// saber se já pode liberar o acesso ao dashboard ou se ainda tem que
// mostrar a tela de "assine agora".
router.get('/status', requireLoggedInUser, async (req, res) => {
  try {
    const result = await pool.query('SELECT status FROM subscriptions WHERE user_id = $1', [req.session.userId]);
    res.json({ status: result.rows[0]?.status || 'pending' });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao consultar status da assinatura.' });
  }
});

// Webhook chamado pelo Mercado Pago quando o status de uma assinatura muda
// (pagamento aprovado, cancelado, etc). Não confiamos no corpo da notificação
// pra decidir o status — buscamos a verdade direto na API deles usando o
// preapproval_id recebido, e só então atualizamos nosso banco.
router.post('/webhook', async (req, res) => {
  try {
    const preapprovalId = req.body?.data?.id || req.query['data.id'];
    const type = req.body?.type || req.query.type;

    if (type !== 'subscription_preapproval' || !preapprovalId) {
      // Outros tipos de notificação (pagamentos avulsos, etc) — confirmamos
      // recebimento e ignoramos, não são relevantes pra essa ferramenta.
      return res.status(200).send('ok');
    }

    const status = await getSubscriptionStatus(preapprovalId);

    await pool.query(
      `UPDATE subscriptions SET status = $1, updated_at = now() WHERE mp_preapproval_id = $2`,
      [status, preapprovalId]
    );

    console.log(`[webhook] Assinatura ${preapprovalId} atualizada para status "${status}".`);
    res.status(200).send('ok');
  } catch (err) {
    console.error('[subscription/webhook]', err.response?.data || err.message);
    // Sempre responde 200 pro Mercado Pago não ficar reenviando a notificação
    // indefinidamente por causa de um erro do nosso lado.
    res.status(200).send('erro processado');
  }
});

module.exports = router;
