const axios = require('axios');

const BASE_URL = 'https://api.mercadolibre.com';

/**
 * Busca concorrentes reais na mesma categoria, usando a busca PÚBLICA do
 * Mercado Livre (a mesma que o comprador usa) — não precisa de OAuth nem
 * de nenhuma API paga de terceiro. Devolve os concorrentes e algumas médias
 * úteis para comparação (preço, nº de fotos, % com frete grátis).
 */
async function searchCompetitors(categoryId, keywords, excludeItemId, limit = 8) {
  const { data } = await axios.get(`${BASE_URL}/sites/MLB/search`, {
    params: { category: categoryId, q: keywords, limit: limit + 1 }
  });

  const results = (data.results || [])
    .filter((r) => r.id !== excludeItemId)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      title: r.title,
      price: r.price,
      sold_quantity: r.sold_quantity || 0,
      free_shipping: r.shipping?.free_shipping ?? false,
      pictures_count: (r.pictures || []).length
    }));

  if (results.length === 0) {
    return { competitors: [], avgPrice: null, avgPictures: null, freeShippingRate: null };
  }

  const avgPrice = results.reduce((sum, r) => sum + r.price, 0) / results.length;
  const avgPictures = results.reduce((sum, r) => sum + r.pictures_count, 0) / results.length;
  const freeShippingRate = (results.filter((r) => r.free_shipping).length / results.length) * 100;

  return {
    competitors: results,
    avgPrice: Number(avgPrice.toFixed(2)),
    avgPictures: Number(avgPictures.toFixed(1)),
    freeShippingRate: Number(freeShippingRate.toFixed(0))
  };
}

module.exports = { searchCompetitors };
