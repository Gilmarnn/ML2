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

/**
 * Versão "leve" dos detalhes — pede só os campos necessários pra filtrar/ordenar
 * (usando o parâmetro attributes da API do ML), bem mais rápida que buscar o
 * item inteiro. Usada pra montar o índice que alimenta filtros e a barra lateral
 * de categorias, sem precisar baixar título/fotos/descrição de todo mundo.
 */
async function getItemsLight(itemIds, accessToken) {
  const api = client(accessToken);
  const chunks = [];
  for (let i = 0; i < itemIds.length; i += 20) {
    chunks.push(itemIds.slice(i, i + 20));
  }

  const results = [];
  for (const chunk of chunks) {
    const { data } = await api.get('/items', {
      params: {
        ids: chunk.join(','),
        attributes: 'id,category_id,available_quantity,sold_quantity,listing_type_id,price'
      }
    });
    results.push(...data.map((r) => r.body));
  }
  return results;
}

// Dados de categoria são públicos e não mudam com frequência — cache simples
// em memória do processo, compartilhado entre todos os usuários do app.
const categoryDetailCache = new Map();
let siteCategoriesCache = null;

/**
 * Detalhe completo de uma categoria: nome, total de produtos cadastrados
 * nela no Mercado Livre inteiro, e subcategorias filhas.
 */
async function getCategoryDetail(categoryId) {
  if (categoryDetailCache.has(categoryId)) {
    return categoryDetailCache.get(categoryId);
  }
  const { data } = await axios.get(`${BASE_URL}/categories/${categoryId}`);
  const detail = {
    id: data.id,
    name: data.name,
    total_items_in_this_category: data.total_items_in_this_category,
    children_categories: (data.children_categories || []).map((c) => ({ id: c.id, name: c.name })),
    path_from_root: (data.path_from_root || []).map((c) => ({ id: c.id, name: c.name }))
  };
  categoryDetailCache.set(categoryId, detail);
  return detail;
}

async function getCategoryName(categoryId) {
  const detail = await getCategoryDetail(categoryId);
  return detail.name;
}

/**
 * Categorias de topo do site (Brasil) — o ponto de partida da árvore inteira
 * de categorias do Mercado Livre.
 */
async function getSiteCategories() {
  if (siteCategoriesCache) return siteCategoriesCache;
  const { data } = await axios.get(`${BASE_URL}/sites/MLB/categories`);
  siteCategoriesCache = data.map((c) => ({ id: c.id, name: c.name }));
  return siteCategoriesCache;
}

module.exports = {
  getUserItemIds,
  getItemsDetails,
  getItemsLight,
  getCategoryName,
  getCategoryDetail,
  getSiteCategories,
  getItemVisits,
  getUserInfo
};
