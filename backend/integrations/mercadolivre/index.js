const auth = require('./auth');
const api = require('./api');

module.exports = {
  name: 'Mercado Livre',
  auth,
  api,
  capabilities: ['products', 'orders', 'questions', 'categories', 'visits', 'financials'],
  isConfigured() {
    return Boolean(process.env.ML_CLIENT_ID && process.env.ML_CLIENT_SECRET && process.env.ML_REDIRECT_URI);
  }
};
