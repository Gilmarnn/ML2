const axios = require('axios');

/**
 * Envia e-mail via Resend (https://resend.com — API simples, tem plano
 * gratuito). Sem RESEND_API_KEY configurada, ou com EMAIL_MOCK_MODE=true,
 * só imprime o conteúdo no log do servidor — útil pra testar o fluxo de
 * "esqueci minha senha" sem precisar configurar um provedor de e-mail ainda.
 */
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (process.env.EMAIL_MOCK_MODE === 'true' || !apiKey) {
    console.log('\n[email/mock] ===== E-mail que seria enviado =====');
    console.log(`[email/mock] Para: ${to}`);
    console.log(`[email/mock] Assunto: ${subject}`);
    console.log(`[email/mock] Conteúdo:\n${html.replace(/<[^>]+>/g, ' ').trim()}`);
    console.log('[email/mock] =====================================\n');
    return { mocked: true };
  }

  const fromAddress = process.env.EMAIL_FROM || 'onboarding@resend.dev';

  const { data } = await axios.post(
    'https://api.resend.com/emails',
    { from: fromAddress, to, subject, html },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
  );
  return data;
}

module.exports = { sendEmail };
