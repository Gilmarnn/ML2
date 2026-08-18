const axios = require('axios');

const MP_BASE_URL = 'https://api.mercadopago.com';

/**
 * Cria uma assinatura (preapproval) SEM plano associado — mais simples pra
 * começar: não precisa cadastrar um "plano" antes, cada assinatura já nasce
 * com o valor e a frequência definidos direto. O Mercado Pago devolve um
 * "init_point": a URL da página de checkout hospedada por eles, pra onde a
 * gente redireciona o assinante completar o pagamento (cartão, e depois
 * também é possível oferecer débito automático).
 */
async function createSubscription({ userEmail, userId, backUrl }) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('MP_ACCESS_TOKEN não configurado no servidor.');
  }

  const price = Number(process.env.SUBSCRIPTION_PRICE_BRL || '49.90');

  const { data } = await axios.post(
    `${MP_BASE_URL}/preapproval`,
    {
      reason: 'Assinatura Diagnóstico ML',
      external_reference: String(userId),
      payer_email: userEmail,
      back_url: backUrl,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: price,
        currency_id: 'BRL'
      }
    },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );

  return { preapprovalId: data.id, checkoutUrl: data.init_point };
}

/**
 * Busca o status atual de uma assinatura direto na API do Mercado Pago —
 * usado pelo webhook como fonte da verdade, em vez de confiar cegamente no
 * conteúdo da notificação recebida (que pode ser forjada por terceiros;
 * já a resposta desse GET, autenticada com nosso próprio token, não pode).
 */
async function getSubscriptionStatus(preapprovalId) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  const { data } = await axios.get(`${MP_BASE_URL}/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return data.status; // 'pending' | 'authorized' | 'paused' | 'cancelled'
}

module.exports = { createSubscription, getSubscriptionStatus };
