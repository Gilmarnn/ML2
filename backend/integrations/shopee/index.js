const auth = require('./auth');
const api = require('./api');

module.exports = {
  name: 'Shopee',
  auth,
  api,
  capabilities: ['products', 'orders', 'shop'],
  isConfigured() {
    return Boolean(process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_PARTNER_KEY && process.env.SHOPEE_REDIRECT_URI);
  }
};
