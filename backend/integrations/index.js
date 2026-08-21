const mercadolivre = require('./mercadolivre');
const tiktok = require('./tiktok');
const shopee = require('./shopee');

const adapters = { mercadolivre, tiktok, shopee };

function getAdapter(platform) {
  return adapters[platform] || null;
}

function listPlatforms() {
  return Object.entries(adapters).map(([id, adapter]) => ({
    id,
    name: adapter.name,
    configured: adapter.isConfigured(),
    capabilities: adapter.capabilities
  }));
}

module.exports = { getAdapter, listPlatforms };
