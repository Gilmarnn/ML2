const axios = require('axios');

const BASE_URL = 'https://api.mercadolibre.com';

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Busca uma amostra de anúncios comparáveis na busca do Mercado Livre.
 * Esta é uma referência de mercado, não o "price_to_win" oficial do catálogo.
 */
async function searchCompetitors(categoryId, keywords, excludeItemId, limit = 8) {
  const { data } = await axios.get(`${BASE_URL}/sites/MLB/search`, {
    params: { category: categoryId, q: keywords, limit: Math.min(50, limit + 1) },
    timeout: 12000
  });

  const results = (data.results || [])
    .filter((r) => r.id !== excludeItemId)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      title: r.title,
      price: Number(r.price || 0),
      sold_quantity: r.sold_quantity || 0,
      free_shipping: r.shipping?.free_shipping ?? false,
      condition: r.condition || null,
      permalink: r.permalink || null,
      thumbnail: r.thumbnail || null,
      seller_id: r.seller?.id || null
    }));

  if (results.length === 0) {
    return {
      competitors: [],
      avgPrice: null,
      avgPictures: null,
      medianPrice: null,
      minPrice: null,
      maxPrice: null,
      freeShippingRate: null
    };
  }

  const prices = results.map((r) => r.price).filter((p) => p > 0);
  const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  const freeShippingRate = (results.filter((r) => r.free_shipping).length / results.length) * 100;

  return {
    competitors: results,
    avgPrice: round2(avgPrice),
    avgPictures: null,
    medianPrice: round2(median(prices)),
    minPrice: round2(Math.min(...prices)),
    maxPrice: round2(Math.max(...prices)),
    freeShippingRate: Math.round(freeShippingRate)
  };
}

module.exports = { searchCompetitors };
