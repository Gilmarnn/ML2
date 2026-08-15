const axios = require('axios');

const BASE_URL = 'https://api.mercadolibre.com';

function client(accessToken) {
  return axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

/**
 * Busca todos os IDs de anúncios ativos do usuário.
 * O endpoint de busca só devolve os IDs — os detalhes vêm num segundo passo.
 */
async function getUserItemIds(userId, accessToken) {
  const api = client(accessToken);
  const ids = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const { data } = await api.get(`/users/${userId}/items/search`, {
      params: { offset, limit }
    });
    ids.push(...data.results);
    if (data.paging.offset + data.paging.limit >= data.paging.total) break;
    offset += limit;
  }

  return ids;
}

/**
 * Busca detalhes de vários anúncios de uma vez.
 * A API do ML aceita no máximo 20 IDs por chamada no endpoint multiget (/items?ids=).
 */
async function getItemsDetails(itemIds, accessToken) {
  const api = client(accessToken);
  const chunks = [];
  for (let i = 0; i < itemIds.length; i += 20) {
    chunks.push(itemIds.slice(i, i + 20));
  }

  const results = [];
  for (const chunk of chunks) {
    const { data } = await api.get('/items', { params: { ids: chunk.join(',') } });
    // Cada item vem envelopado como { code, body }
    results.push(...data.map((r) => r.body));
  }
  return results;
}

/**
 * Visitas de um anúncio específico numa janela de tempo (em dias).
 */
async function getItemVisits(itemId, accessToken, lastDays = 30) {
  const api = client(accessToken);
  const { data } = await api.get(`/items/${itemId}/visits/time_window`, {
    params: { last: lastDays, unit: 'day' }
  });
  return data;
}

/**
 * Reputação/status do vendedor (usada no diagnóstico geral da conta).
 */
async function getUserInfo(userId, accessToken) {
  const api = client(accessToken);
  const { data } = await api.get(`/users/${userId}`);
  return data;
}

module.exports = {
  getUserItemIds,
  getItemsDetails,
  getItemVisits,
  getUserInfo
};
