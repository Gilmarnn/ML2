const auth = require('./auth');
const api = require('./api');

module.exports = {
  name: 'TikTok Shop',
  auth,
  api,
  capabilities: ['products', 'orders', 'shops'],
  isConfigured() {
    return Boolean(
      process.env.TIKTOK_APP_KEY &&
      process.env.TIKTOK_APP_SECRET &&
      process.env.TIKTOK_SERVICE_ID
    );
  }
};
