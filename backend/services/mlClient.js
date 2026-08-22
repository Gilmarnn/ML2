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
        attributes: 'id,title,category_id,available_quantity,sold_quantity,listing_type_id,price'
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
async function getCategoryDetail(categoryId, accessToken) {
  if (categoryDetailCache.has(categoryId)) {
    return categoryDetailCache.get(categoryId);
  }
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const { data } = await axios.get(`${BASE_URL}/categories/${categoryId}`, { headers });
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

async function getCategoryName(categoryId, accessToken) {
  const detail = await getCategoryDetail(categoryId, accessToken);
  return detail.name;
}

/**
 * Categorias de topo do site (Brasil) — o ponto de partida da árvore inteira
 * de categorias do Mercado Livre.
 */
async function getSiteCategories(accessToken) {
  if (siteCategoriesCache) return siteCategoriesCache;
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const { data } = await axios.get(`${BASE_URL}/sites/MLB/categories`, { headers });
  siteCategoriesCache = data.map((c) => ({ id: c.id, name: c.name }));
  return siteCategoriesCache;
}

/**
 * Descrição em texto do anúncio — vem de um endpoint separado na API do ML,
 * não junto com os detalhes principais do item.
 */
async function getItemDescription(itemId, accessToken) {
  const api = client(accessToken);
  try {
    const { data } = await api.get(`/items/${itemId}/description`);
    return data.plain_text || '';
  } catch (e) {
    return '';
  }
}

/**
 * Perguntas feitas nos anúncios (pré-venda) — não respondê-las rápido
 * derruba a conversão. Busca as pendentes de resposta.
 */
async function getUnansweredQuestions(userId, accessToken) {
  const api = client(accessToken);
  const { data } = await api.get('/questions/search', {
    params: { seller_id: userId, status: 'UNANSWERED', sort_fields: 'date_created', sort_types: 'DESC', limit: 50 }
  });
  return data.questions || [];
}

async function answerQuestion(questionId, text, accessToken) {
  const api = client(accessToken);
  const { data } = await api.post('/answers', { question_id: questionId, text });
  return data;
}

/**
 * Pedidos (vendas) do vendedor num período — a fonte real de faturamento,
 * diferente de "sold_quantity" do item (que é total histórico do anúncio,
 * não fatiado por data). Pagina automaticamente até um limite de segurança.
 */

/**
 * Competição em catálogo / preço para ganhar.
 * Só existe para anúncios elegíveis/participantes da competição de catálogo.
 * Quando o item não participa, a API pode responder 404/400; o chamador deve
 * tratar isso como "sem dado oficial" e usar comparação de mercado como fallback.
 */
async function getPriceToWin(itemId, accessToken) {
  const api = client(accessToken);
  try {
    const { data } = await api.get(`/items/${itemId}/price_to_win`, {
      params: { version: 'v2' }
    });
    return data;
  } catch (err) {
    const status = err.response?.status;
    if (status === 400 || status === 403 || status === 404) return null;
    throw err;
  }
}


/**
 * Avaliações/opiniões do anúncio. Endpoint oficial de Reviews do Mercado Livre.
 * Retorna média de estrelas, distribuição e comentários recentes.
 */
async function getItemReviews(itemId, accessToken, { offset = 0, limit = 10, catalogProductId = null } = {}) {
  const api = client(accessToken);
  const params = { offset: Math.max(0, Number(offset) || 0), limit: Math.min(20, Math.max(1, Number(limit) || 10)) };
  if (catalogProductId) params.catalog_product_id = catalogProductId;
  const { data } = await api.get(`/reviews/item/${itemId}`, { params });
  return data;
}

async function getOrders(userId, accessToken, { fromDate, toDate, maxOrders = 300, itemId = null } = {}) {
  const api = client(accessToken);
  const orders = [];
  let offset = 0;
  const limit = 50;

  while (orders.length < maxOrders) {
    const params = {
      seller: userId,
      'order.status': 'paid',
      'order.date_created.from': fromDate,
      'order.date_created.to': toDate,
      sort: 'date_desc',
      offset,
      limit
    };
    // O filtro q da busca de orders aceita ID do item e reduz drasticamente
    // o volume de dados quando o Motor de Conversão analisa um anúncio.
    if (itemId) params.q = itemId;

    const { data } = await api.get('/orders/search', { params });

    orders.push(...(data.results || []));
    if (!data.results || data.results.length < limit || orders.length >= data.paging.total) break;
    offset += limit;
  }

  return orders;
}


async function getProductAdsAdvertiser(accessToken) {
  const api = client(accessToken);
  try {
    const { data } = await api.get('/advertising/advertisers', {
      params: { product_id: 'PADS' },
      headers: { 'Api-Version': '1', 'Content-Type': 'application/json' }
    });
    const advertisers = data.advertisers || [];
    return advertisers.find((a) => a.site_id === 'MLB') || advertisers[0] || null;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

async function getProductAdsAdGroup(itemId, advertiser, accessToken) {
  if (!advertiser?.advertiser_id || !advertiser?.site_id) return null;
  const api = client(accessToken);
  const { data } = await api.get(`/advertising/${advertiser.site_id}/advertisers/${advertiser.advertiser_id}/product_ads/ad_groups/search`, {
    params: { 'filters[item_ids]': itemId },
    headers: { 'api-version': '2' }
  });
  const results = data.results || [];
  return results.find((g) => String(g.ad_group_external_id) === String(itemId)) || results[0] || null;
}

async function getProductAdsAdGroupMetrics(siteId, campaignId, adGroupId, accessToken, { dateFrom, dateTo } = {}) {
  if (!siteId || !campaignId || !adGroupId) return null;
  const api = client(accessToken);
  const metrics = ['clicks','prints','cost','cpc','ctr','direct_amount','indirect_amount','total_amount','direct_units_quantity','indirect_units_quantity','units_quantity','direct_items_quantity','indirect_items_quantity','advertising_items_quantity','organic_units_quantity','organic_units_amount','organic_items_quantity','acos','tacos','sov','cvr','roas'].join(',');
  const { data } = await api.get(`/advertising/${siteId}/product_ads/campaigns/${campaignId}/ad_groups/metrics`, {
    params: { date_from: dateFrom, date_to: dateTo, metrics },
    headers: { 'api-version': '2' }
  });
  const row = (data.results || []).find((r) => String(r.ad_group_id) === String(adGroupId));
  return row?.metrics || null;
}

async function getProductAdsCampaign(advertiser, campaignId, accessToken, { dateFrom, dateTo } = {}) {
  if (!advertiser?.advertiser_id || !advertiser?.site_id || !campaignId) return null;
  const api = client(accessToken);
  const metrics = ['clicks','prints','ctr','cost','cpc','acos','cvr','roas','sov','direct_units_quantity','indirect_units_quantity','units_quantity','direct_amount','indirect_amount','total_amount','impression_share','top_impression_share','lost_impression_share_by_budget','lost_impression_share_by_ad_rank','acos_benchmark'].join(',');
  const { data } = await api.get(`/advertising/${advertiser.site_id}/advertisers/${advertiser.advertiser_id}/product_ads/campaigns/search`, {
    params: { limit: 50, offset: 0, date_from: dateFrom, date_to: dateTo, metrics, 'filters[campaign_ids]': String(campaignId) },
    headers: { 'api-version': '2' }
  });
  return (data.results || []).find((c) => String(c.id) === String(campaignId)) || null;
}

module.exports = {
  getUserItemIds,
  getItemsDetails,
  getItemsLight,
  getItemDescription,
  getCategoryName,
  getCategoryDetail,
  getSiteCategories,
  getItemVisits,
  getUserInfo,
  getUnansweredQuestions,
  answerQuestion,
  getOrders,
  getPriceToWin,
  getItemReviews,
  getProductAdsAdvertiser,
  getProductAdsAdGroup,
  getProductAdsAdGroupMetrics,
  getProductAdsCampaign
};
