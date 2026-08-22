// ---------- Visium Seller: contexto multicanal ----------
let activeMarketplaceAccountId = localStorage.getItem('visium:marketplaceAccountId') || '';
let activeMarketplacePlatform = '';
let marketplaceAccounts = [];

function withAccount(url) {
  if (!url.startsWith('/api/') || url.startsWith('/api/unified/') || !activeMarketplaceAccountId) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}accountId=${encodeURIComponent(activeMarketplaceAccountId)}`;
}

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  if (typeof input === 'string') input = withAccount(input);
  return nativeFetch(input, init);
};

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function platformLabel(platform) {
  return ({ mercadolivre: 'Mercado Livre', tiktok: 'TikTok Shop', shopee: 'Shopee' })[platform] || platform;
}

function currentAccount() {
  return marketplaceAccounts.find((a) => String(a.id) === String(activeMarketplaceAccountId)) || null;
}

async function loadPlatformActions() {
  const wrap = document.getElementById('marketplace-actions');
  try {
    const res = await nativeFetch('/integrations/platforms');
    const data = await res.json();
    wrap.innerHTML = (data.platforms || []).map((p) => {
      const cls = `marketplace-connect ${p.id === 'mercadolivre' ? 'ml' : p.id}`;
      if (!p.configured) return `<span class="${cls} disabled" title="Configure as credenciais no Railway">${escapeHtml(p.name)} · configurar</span>`;
      return `<a class="${cls}" href="/integrations/connect/${encodeURIComponent(p.id)}">+ ${escapeHtml(p.name)}</a>`;
    }).join('');
  } catch (err) {
    wrap.innerHTML = '<span class="marketplace-status">Não foi possível carregar os canais.</span>';
  }
}

async function loadMarketplaceAccounts() {
  const select = document.getElementById('marketplace-account-select');
  const status = document.getElementById('marketplace-connection-status');
  try {
    const res = await nativeFetch('/integrations/accounts');
    const data = await res.json();
    marketplaceAccounts = data.accounts || [];
    if (!marketplaceAccounts.length) {
      activeMarketplaceAccountId = '';
      activeMarketplacePlatform = '';
      localStorage.removeItem('visium:marketplaceAccountId');
      select.innerHTML = '<option value="">Nenhuma conta conectada</option>';
      status.textContent = 'Conecte seu primeiro canal de vendas.';
      return;
    }
    select.innerHTML = '<option value="">Todos os canais</option>' + marketplaceAccounts.map((a) => `<option value="${a.id}">${escapeHtml(platformLabel(a.platform))} · ${escapeHtml(a.account_name || a.seller_id)}</option>`).join('');
    const urlAccount = new URLSearchParams(location.search).get('account');
    if (urlAccount && marketplaceAccounts.some((a) => String(a.id) === String(urlAccount))) activeMarketplaceAccountId = String(urlAccount);
    if (activeMarketplaceAccountId && !marketplaceAccounts.some((a) => String(a.id) === String(activeMarketplaceAccountId))) activeMarketplaceAccountId = '';
    // Se só existe uma conta conectada, ela deve ser a conta ativa por padrão.
    // Antes o dashboard permanecia em "Todos os canais", o que fazia as abas do ML
    // parecerem quebradas porque não havia plataforma ativa.
    if (!activeMarketplaceAccountId && marketplaceAccounts.length === 1) {
      activeMarketplaceAccountId = String(marketplaceAccounts[0].id);
    }
    select.value = activeMarketplaceAccountId;
    if (activeMarketplaceAccountId) localStorage.setItem('visium:marketplaceAccountId', activeMarketplaceAccountId);
    else localStorage.removeItem('visium:marketplaceAccountId');
    const current = currentAccount();
    activeMarketplacePlatform = current?.platform || '';
    status.textContent = current ? `${platformLabel(current.platform)} conectado · ${current.account_name || current.seller_id}` : 'Visão consolidada de todos os canais.';
  } catch (err) {
    select.innerHTML = '<option value="">Erro ao carregar contas</option>';
    status.textContent = 'Não foi possível consultar as conexões.';
    console.error(err);
  }
}

async function loadOverview() {
  const status = document.getElementById('overview-status');
  const content = document.getElementById('overview-content');
  status.hidden = false;
  status.textContent = 'Carregando visão geral…';
  content.hidden = true;
  try {
    const query = activeMarketplaceAccountId ? `?accountId=${encodeURIComponent(activeMarketplaceAccountId)}` : '';
    const [overviewRes, productsRes] = await Promise.all([
      nativeFetch(`/api/unified/overview${query}`),
      nativeFetch(`/api/unified/products${query}${query ? '&' : '?'}limit=20`)
    ]);
    const overview = await overviewRes.json();
    const productData = await productsRes.json();
    if (!overviewRes.ok) throw new Error(overview.error || 'Falha ao carregar visão geral.');
    document.getElementById('overview-revenue').textContent = formatMoney(overview.last30Days?.revenue || 0);
    document.getElementById('overview-orders').textContent = Number(overview.last30Days?.orderCount || 0).toLocaleString('pt-BR');
    document.getElementById('overview-ticket').textContent = formatMoney(overview.last30Days?.averageTicket || 0);
    document.getElementById('overview-accounts').textContent = overview.accounts?.length || 0;
    const products = productData.products || [];
    document.getElementById('unified-products').innerHTML = products.length ? products.map((p) => `
      <div class="unified-product">
        ${p.thumbnail ? `<img src="${escapeHtml(fixThumb(p.thumbnail))}" alt="">` : '<div></div>'}
        <div><strong>${escapeHtml(p.title)}</strong><div class="meta">${escapeHtml(p.account_name || '')} · estoque ${Number(p.stock || 0).toLocaleString('pt-BR')}</div></div>
        <span class="platform-pill">${escapeHtml(platformLabel(p.platform))}</span>
        <strong>${formatMoney(p.price || 0)}</strong>
      </div>`).join('') : '<div class="status">Nenhum produto sincronizado ainda. Use “Sincronizar conta ativa”.</div>';
    status.hidden = true;
    content.hidden = false;
  } catch (err) {
    status.textContent = err.message || 'Falha ao carregar visão geral.';
    console.error(err);
  }
}

async function syncActiveAccount() {
  const btn = document.getElementById('sync-account-btn');
  const status = document.getElementById('marketplace-connection-status');
  if (!activeMarketplaceAccountId) {
    const onlyAccount = marketplaceAccounts.length === 1 ? marketplaceAccounts[0] : null;
    if (onlyAccount) {
      activeMarketplaceAccountId = String(onlyAccount.id);
      activeMarketplacePlatform = onlyAccount.platform;
      document.getElementById('marketplace-account-select').value = activeMarketplaceAccountId;
      localStorage.setItem('visium:marketplaceAccountId', activeMarketplaceAccountId);
    } else {
      status.textContent = 'Selecione uma conta antes de sincronizar.';
      return;
    }
  }
  btn.classList.add('marketplace-syncing');
  btn.textContent = 'Sincronizando…';
  try {
    const res = await nativeFetch(`/integrations/accounts/${encodeURIComponent(activeMarketplaceAccountId)}/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 30 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha na sincronização.');
    status.textContent = `Sincronização concluída · ${data.products?.count || 0} produtos · ${data.orders?.count || 0} pedidos`;
    await loadOverview();
    if (activeMarketplacePlatform === 'mercadolivre') { loadCategories(); loadItems(true); }
  } catch (err) {
    status.textContent = err.message;
  } finally {
    btn.classList.remove('marketplace-syncing');
    btn.textContent = 'Sincronizar conta ativa';
  }
}

document.getElementById('marketplace-account-select').addEventListener('change', async (e) => {
  activeMarketplaceAccountId = e.target.value;
  localStorage.setItem('visium:marketplaceAccountId', activeMarketplaceAccountId);
  const current = currentAccount();
  activeMarketplacePlatform = current?.platform || '';
  document.getElementById('marketplace-connection-status').textContent = current ? `${platformLabel(current.platform)} conectado · ${current.account_name || current.seller_id}` : 'Visão consolidada de todos os canais.';
  loadedItems = []; currentOffset = 0; questionsLoadedOnce = false;
  await loadOverview();
  if (activeMarketplacePlatform === 'mercadolivre') {
    loadCategories(); loadItems(true);
  } else {
    switchTab('overview');
  }
});

document.getElementById('sync-account-btn').addEventListener('click', syncActiveAccount);

const tabOverview = document.getElementById('tab-overview');
const tabItems = document.getElementById('tab-items');
const tabQuestions = document.getElementById('tab-questions');
const tabFinancials = document.getElementById('tab-financials');
const tabExplore = document.getElementById('tab-explore');
const tabCalc = document.getElementById('tab-calc');
const panelOverview = document.getElementById('panel-overview');
const panelItems = document.getElementById('panel-items');
const panelQuestions = document.getElementById('panel-questions');
const panelFinancials = document.getElementById('panel-financials');
const panelExplore = document.getElementById('panel-explore');
const panelCalc = document.getElementById('panel-calc');

async function ensureMercadoLivreAccount() {
  if (activeMarketplacePlatform === 'mercadolivre' && activeMarketplaceAccountId) return true;
  const mlAccount = marketplaceAccounts.find((a) => a.platform === 'mercadolivre' && a.status !== 'disconnected');
  if (!mlAccount) {
    document.getElementById('marketplace-connection-status').textContent = 'Conecte uma conta do Mercado Livre para usar esta área.';
    return false;
  }
  activeMarketplaceAccountId = String(mlAccount.id);
  activeMarketplacePlatform = 'mercadolivre';
  localStorage.setItem('visium:marketplaceAccountId', activeMarketplaceAccountId);
  const accountSelect = document.getElementById('marketplace-account-select');
  accountSelect.value = activeMarketplaceAccountId;
  document.getElementById('marketplace-connection-status').textContent = `Mercado Livre conectado · ${mlAccount.account_name || mlAccount.seller_id}`;
  return true;
}

async function openMlTab(tab) {
  if (!await ensureMercadoLivreAccount()) return;
  switchTab(tab);
}

tabOverview.addEventListener('click', () => switchTab('overview'));
tabItems.addEventListener('click', () => openMlTab('items'));
tabQuestions.addEventListener('click', () => openMlTab('questions'));
tabFinancials.addEventListener('click', () => openMlTab('financials'));
tabExplore.addEventListener('click', () => openMlTab('explore'));
tabCalc.addEventListener('click', () => switchTab('calc'));

let questionsLoadedOnce = false;

function switchTab(tab) {
  if (activeMarketplacePlatform !== 'mercadolivre' && ['items','questions','financials','explore'].includes(tab)) tab = 'overview';
  panelOverview.hidden = tab !== 'overview';
  panelItems.hidden = tab !== 'items';
  panelQuestions.hidden = tab !== 'questions';
  panelFinancials.hidden = tab !== 'financials';
  panelExplore.hidden = tab !== 'explore';
  panelCalc.hidden = tab !== 'calc';
  tabOverview.classList.toggle('active', tab === 'overview');
  tabItems.classList.toggle('active', tab === 'items');
  tabQuestions.classList.toggle('active', tab === 'questions');
  tabFinancials.classList.toggle('active', tab === 'financials');
  tabExplore.classList.toggle('active', tab === 'explore');
  tabCalc.classList.toggle('active', tab === 'calc');

  if (tab === 'overview') loadOverview();
  if (tab === 'explore' && !exploreLoadedOnce) {
    exploreLoadedOnce = true;
    loadExploreCategories(null);
  }
  if (tab === 'questions' && !questionsLoadedOnce) {
    questionsLoadedOnce = true;
    loadQuestions();
  }
  if (tab === 'financials') {
    loadFinancials();
  }
}

function scoreClass(score) {
  if (score >= 75) return 'score-good';
  if (score >= 50) return 'score-warn';
  return 'score-bad';
}

// Ícones inline (sem dependência externa) usados nos cards.
const ICONS = {
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>',
  truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62L18.3 8.38A1 1 0 0 0 17.52 8H14"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 4.9L5 10l5.1 2.1L12 17l1.9-4.9L19 10l-5.1-2.1Z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/></svg>'
};

function fixThumb(url) {
  // A API do ML às vezes devolve o thumbnail em http:// puro, o que o navegador
  // bloqueia como conteúdo misto numa página https. Forçamos https aqui.
  if (!url) return '';
  return url.replace(/^http:\/\//, 'https://');
}

function listingTypeLabel(id) {
  // IDs conhecidos da API do ML para tipo de anúncio.
  if (id === 'gold_pro' || id === 'gold_premium') return 'Premium';
  if (id === 'gold_special' || id === 'silver' || id === 'bronze') return 'Clássico';
  return null;
}

// ---------- Custo por item e configuracoes globais (salvos no navegador) ----------

function loadSettings() {
  try {
    const raw = localStorage.getItem('ml-diagnostico:settings');
    return raw ? JSON.parse(raw) : { commission: 12, tax: 0 };
  } catch (e) {
    return { commission: 12, tax: 0 };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem('ml-diagnostico:settings', JSON.stringify(settings));
  } catch (e) {
    console.error('Não foi possível salvar as configurações no navegador.', e);
  }
}

function getItemCost(itemId) {
  try {
    const raw = localStorage.getItem(`ml-diagnostico:cost:${itemId}`);
    return raw !== null ? Number(raw) : null;
  } catch (e) {
    return null;
  }
}

function setItemCost(itemId, value) {
  try {
    if (value === null || Number.isNaN(value)) {
      localStorage.removeItem(`ml-diagnostico:cost:${itemId}`);
    } else {
      localStorage.setItem(`ml-diagnostico:cost:${itemId}`, String(value));
    }
  } catch (e) {
    console.error('Não foi possível salvar o custo no navegador.', e);
  }
}

function renderProfit(price, cost, commissionPercent, taxPercent) {
  if (cost === null || cost === undefined || Number.isNaN(cost)) {
    return '<div class="item-card-profit profit-empty">Informe o custo para ver o lucro</div>';
  }
  const commissionValue = price * (commissionPercent / 100);
  const taxValue = price * (taxPercent / 100);
  const profit = price - cost - commissionValue - taxValue;
  const marginPercent = price > 0 ? (profit / price) * 100 : 0;
  const cls = profit >= 0 ? 'profit-positive' : 'profit-negative';
  return `<div class="item-card-profit ${cls}">Lucro: R$ ${profit.toFixed(2)} (${marginPercent.toFixed(1)}%)</div>`;
}

const globalSettings = loadSettings();
document.getElementById('global-commission').value = globalSettings.commission;
document.getElementById('global-tax').value = globalSettings.tax;

function onGlobalSettingsChange() {
  globalSettings.commission = Number(document.getElementById('global-commission').value) || 0;
  globalSettings.tax = Number(document.getElementById('global-tax').value) || 0;
  saveSettings(globalSettings);
  document.querySelectorAll('.item-card').forEach((card) => {
    const itemId = card.dataset.itemId;
    const price = Number(card.dataset.price);
    const cost = getItemCost(itemId);
    card.querySelector('.item-card-profit-wrap').innerHTML = renderProfit(
      price,
      cost,
      globalSettings.commission,
      globalSettings.tax
    );
  });
}

document.getElementById('global-commission').addEventListener('input', onGlobalSettingsChange);
document.getElementById('global-tax').addEventListener('input', onGlobalSettingsChange);

let loadedItems = [];
let currentOffset = 0;
let totalItems = null;
const activeFilters = { category: '', stock: '', listingType: '', sortBy: '' };

function buildQueryString(offset) {
  const params = new URLSearchParams({ offset: String(offset), limit: '30' });
  if (activeFilters.category) params.set('category', activeFilters.category);
  if (activeFilters.stock) params.set('stock', activeFilters.stock);
  if (activeFilters.listingType) params.set('listingType', activeFilters.listingType);
  if (activeFilters.sortBy) params.set('sortBy', activeFilters.sortBy);
  return params.toString();
}

async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    if (res.status === 401) return;
    const data = await res.json();
    const list = document.getElementById('category-list');

    const itemsHtml = data.categories
      .map(
        (cat) => `
        <button class="category-item" data-category="${cat.id}">
          <span>
            <span title="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</span>
            ${cat.marketSize !== null ? `<span class="sidebar-market-size">${formatNumber(cat.marketSize)} no ML</span>` : ''}
          </span>
          <span class="count">${cat.count}</span>
        </button>`
      )
      .join('');

    list.insertAdjacentHTML('beforeend', itemsHtml);
    list.querySelector('.category-item[data-category=""]').querySelector('.count')?.remove();
    const allCountSpan = document.createElement('span');
    allCountSpan.className = 'count';
    allCountSpan.textContent = data.total;
    list.querySelector('.category-item[data-category=""]').appendChild(allCountSpan);

    list.querySelectorAll('.category-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        list.querySelectorAll('.category-item').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilters.category = btn.dataset.category;
        loadItems(true);
      });
    });
  } catch (err) {
    console.error('Erro ao carregar categorias', err);
  }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await fetch('/user/logout', { method: 'POST' });
  } catch (err) {
    // segue para o redirect mesmo se a chamada falhar
  }
  window.location.href = '/login.html';
});

document.getElementById('filter-stock').addEventListener('change', (e) => {
  activeFilters.stock = e.target.value;
  loadItems(true);
});
document.getElementById('filter-listing-type').addEventListener('change', (e) => {
  activeFilters.listingType = e.target.value;
  loadItems(true);
});
document.getElementById('filter-sort').addEventListener('change', (e) => {
  activeFilters.sortBy = e.target.value;
  loadItems(true);
});

async function loadItems(isFirstPage = true) {
  const statusEl = document.getElementById('items-status');
  const grid = document.getElementById('items-grid');
  const loadMoreWrap = document.getElementById('load-more-wrap');
  const loadMoreBtn = document.getElementById('load-more-btn');
  const loadMoreCount = document.getElementById('load-more-count');

  if (isFirstPage) {
    statusEl.hidden = false;
    statusEl.textContent = 'Carregando anúncios…';
    grid.hidden = true;
    grid.innerHTML = '';
    loadMoreWrap.hidden = true;
    loadedItems = [];
    currentOffset = 0;
  } else {
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'Carregando…';
  }

  try {
    const res = await fetch(`/api/items?${buildQueryString(currentOffset)}`);
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    const data = await res.json();
    totalItems = data.total;

    if (isFirstPage && (!data.items || data.items.length === 0)) {
      statusEl.textContent = 'Nenhum anúncio encontrado nesta conta.';
      return;
    }

    loadedItems = loadedItems.concat(data.items);
    currentOffset += data.items.length;

    const cardsHtml = data.items
      .map((item) => {
        const stockZero = item.available_quantity === 0;
        const visitsZero = (item.visits ?? 0) === 0;
        const thumb = fixThumb(item.thumbnail);
        const listingLabel = listingTypeLabel(item.listing_type_id);
        const savedCost = getItemCost(item.id);

        const badgesHtml = `
          <div class="item-card-badges">
            ${item.free_shipping ? `<span class="item-card-badge" title="Frete grátis">${ICONS.truck}</span>` : ''}
            ${listingLabel === 'Premium' ? `<span class="item-card-badge badge-premium">Premium</span>` : ''}
          </div>`;

        return `
        <article class="item-card" data-item-id="${item.id}" data-price="${item.price}">
          <div class="item-card-thumb">
            ${thumb ? `<img src="${thumb}" alt="" loading="lazy" />` : ''}
            ${badgesHtml}
            <span class="item-card-score score-pill ${scoreClass(item.diagnosis.score)}">${item.diagnosis.score}</span>
            <button class="ai-btn" data-ai-id="${item.id}" title="Análise profunda com IA">${ICONS.sparkles} IA</button>
          </div>
          <div class="item-card-body">
            <div class="item-card-title">${escapeHtml(item.title)}</div>
            <div class="item-card-price">R$ ${Number(item.price).toFixed(2)}</div>
            <div class="item-card-stats">
              <span class="item-card-stat ${stockZero ? 'stat-zero' : ''}" title="Estoque">${ICONS.box} ${item.available_quantity}</span>
              <span class="item-card-stat ${visitsZero ? 'stat-zero' : ''}" title="Visitas em 30 dias">${ICONS.eye} ${item.visits ?? '—'}</span>
              <span class="item-card-stat" title="Vendidos (histórico total)">${ICONS.cart} ${item.sold_quantity ?? 0}</span>
            </div>
            <div class="item-card-cost">
              <label for="cost-${item.id}">Custo R$</label>
              <input type="number" step="0.01" min="0" id="cost-${item.id}" class="item-cost-input" data-item-id="${item.id}" value="${savedCost !== null ? savedCost : ''}" placeholder="0,00" />
            </div>
            <div class="item-card-profit-wrap">${renderProfit(item.price, savedCost, globalSettings.commission, globalSettings.tax)}</div>
            <div class="item-card-footer item-card-footer-actions">
              <button class="link-btn radar-btn" data-radar-id="${item.id}">Radar</button>
              <button class="link-btn" data-id="${item.id}">Diagnóstico</button>
            </div>
          </div>
        </article>`;
      })
      .join('');

    grid.insertAdjacentHTML('beforeend', cardsHtml);

    grid.querySelectorAll('button[data-id]:not([data-bound])').forEach((btn) => {
      btn.setAttribute('data-bound', '1');
      btn.addEventListener('click', () => openDiagnosis(btn.dataset.id, loadedItems));
    });

    grid.querySelectorAll('.radar-btn:not([data-bound])').forEach((btn) => {
      btn.setAttribute('data-bound', '1');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCompetitionRadar(btn.dataset.radarId);
      });
    });

    grid.querySelectorAll('.ai-btn:not([data-bound])').forEach((btn) => {
      btn.setAttribute('data-bound', '1');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openAIAnalysis(btn.dataset.aiId);
      });
    });

    grid.querySelectorAll('.item-cost-input:not([data-bound])').forEach((input) => {
      input.setAttribute('data-bound', '1');
      input.addEventListener('input', (e) => {
        const itemId = e.target.dataset.itemId;
        const value = e.target.value === '' ? null : Number(e.target.value);
        setItemCost(itemId, value);
        const card = e.target.closest('.item-card');
        const price = Number(card.dataset.price);
        card.querySelector('.item-card-profit-wrap').innerHTML = renderProfit(
          price,
          value,
          globalSettings.commission,
          globalSettings.tax
        );
      });
    });

    statusEl.hidden = true;
    grid.hidden = false;

    const remaining = totalItems - currentOffset;
    if (remaining > 0) {
      loadMoreWrap.hidden = false;
      loadMoreCount.textContent = `Mostrando ${currentOffset} de ${totalItems} anúncios.`;
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = 'Carregar mais anúncios';
    } else {
      loadMoreWrap.hidden = true;
    }
  } catch (err) {
    statusEl.hidden = false;
    statusEl.textContent = 'Erro ao carregar anúncios. Veja o console para detalhes.';
    console.error(err);
  }
}

document.getElementById('load-more-btn').addEventListener('click', () => loadItems(false));

function openDiagnosis(itemId, items) {
  const item = items.find((i) => i.id === itemId);
  const modal = document.getElementById('diagnosis-modal');
  const body = document.getElementById('modal-body');

  const checksHtml = item.diagnosis.checks
    .map((c) => `<div class="check-row check-${c.status}">${escapeHtml(c.msg)}</div>`)
    .join('');

  const aiHtml = item.diagnosis.aiSuggestions
    ? `<h3>Sugestões geradas por IA</h3><p style="white-space:pre-wrap;font-size:14px;color:var(--text-dim)">${escapeHtml(item.diagnosis.aiSuggestions)}</p>`
    : '';

  body.innerHTML = `
    <h2>${escapeHtml(item.title)}</h2>
    <p style="color:var(--text-dim)">Score: <strong>${item.diagnosis.score}/100</strong></p>
    ${checksHtml}
    ${aiHtml}
  `;
  modal.hidden = false;
}

function radarStatusLabel(status) {
  return ({
    winning: 'Ganhando',
    sharing_first_place: 'Compartilhando 1º lugar',
    competing: 'Perdendo / competindo',
    listed: 'Listado, mas fora da competição'
  })[status] || 'Sem status oficial';
}

function radarStatusClass(status) {
  if (status === 'winning' || status === 'sharing_first_place') return 'radar-good';
  if (status === 'competing') return 'radar-bad';
  return 'radar-neutral';
}

function renderRadarMargin(label, result) {
  if (!result) return '';
  const cls = result.netProfit >= 0 ? 'radar-good-text' : 'radar-bad-text';
  return `
    <div class="radar-margin-row">
      <span>${escapeHtml(label)}</span>
      <strong class="${cls}">${formatMoney(result.netProfit)} · ${Number(result.marginPercent).toFixed(1)}%</strong>
    </div>`;
}

async function openCompetitionRadar(itemId) {
  const modal = document.getElementById('diagnosis-modal');
  const body = document.getElementById('modal-body');
  const productCost = getItemCost(itemId);

  body.innerHTML = `
    <h2>Radar de Concorrência</h2>
    <p style="color:var(--text-dim);font-size:14px">Consultando competição de catálogo e preços de mercado…</p>`;
  modal.hidden = false;

  try {
    const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/competition-radar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productCost: productCost === null ? '' : productCost,
        mlCommissionPercent: globalSettings.commission,
        taxPercent: globalSettings.tax,
        shippingCost: 0,
        fixedFee: 0,
        adsCostPercent: 0
      })
    });
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    const data = await res.json();
    if (!res.ok || data.error) {
      body.innerHTML = `<h2>Radar de Concorrência</h2><p class="check-critico">${escapeHtml(data.error || 'Falha ao consultar o radar.')}</p>`;
      return;
    }

    const official = data.officialCompetition;
    const market = data.market || {};
    const competitors = market.competitors || [];
    const hasOfficialPrice = official.available && official.priceToWin != null;
    const diff = hasOfficialPrice ? Number(official.priceDifference || 0) : null;

    let officialHtml = '';
    if (official.available) {
      officialHtml = `
        <section class="radar-section">
          <div class="radar-section-title">Competição oficial do catálogo</div>
          <div class="radar-status ${radarStatusClass(official.status)}">${escapeHtml(radarStatusLabel(official.status))}</div>
          <div class="radar-metrics">
            <div><span>Seu preço</span><strong>${formatMoney(data.item.price)}</strong></div>
            <div><span>Preço para ganhar</span><strong>${hasOfficialPrice ? formatMoney(official.priceToWin) : 'Não informado'}</strong></div>
            <div><span>Diferença</span><strong>${hasOfficialPrice ? `${diff > 0 ? '-' : diff < 0 ? '+' : ''}${formatMoney(Math.abs(diff))}` : '—'}</strong></div>
          </div>
          ${official.boosts?.length ? `<div class="radar-boosts">${official.boosts.map((b) => `
            <div class="radar-boost ${b.status === 'boosted' ? 'is-on' : b.status === 'opportunity' ? 'is-opportunity' : ''}">
              <span>${escapeHtml(b.description || b.id)}</span><strong>${b.status === 'boosted' ? 'Ativo' : b.status === 'opportunity' ? 'Oportunidade' : 'Sem ganho adicional'}</strong>
            </div>`).join('')}</div>` : ''}
        </section>`;
    } else {
      officialHtml = `
        <section class="radar-section">
          <div class="radar-section-title">Competição oficial do catálogo</div>
          <div class="check-row check-info">Este anúncio não retornou <strong>price_to_win</strong>. O Radar abaixo usa preços observados em anúncios similares e não chama isso de “preço para ganhar”.</div>
        </section>`;
    }

    const marketHtml = competitors.length ? `
      <section class="radar-section">
        <div class="radar-section-title">Referência de mercado</div>
        <div class="radar-metrics radar-metrics-4">
          <div><span>Média</span><strong>${formatMoney(market.avgPrice)}</strong></div>
          <div><span>Mediana</span><strong>${formatMoney(market.medianPrice)}</strong></div>
          <div><span>Menor</span><strong>${formatMoney(market.minPrice)}</strong></div>
          <div><span>Frete grátis</span><strong>${Number(market.freeShippingRate || 0)}%</strong></div>
        </div>
        <p class="radar-note">Na amostra de ${competitors.length} anúncios, ${market.cheaperCount || 0} estão abaixo do seu preço. A busca é uma referência de mercado; produtos podem ter variações de marca, kit, condição e características.</p>
        <div class="radar-competitors">
          ${competitors.slice(0, 6).map((c) => `
            <div class="radar-competitor">
              <div><strong>${escapeHtml(c.title)}</strong><span>${c.free_shipping ? 'Frete grátis' : 'Frete não identificado'} · ${Number(c.sold_quantity || 0).toLocaleString('pt-BR')} vendidos*</span></div>
              <strong>${formatMoney(c.price)}</strong>
            </div>`).join('')}
        </div>
        <p class="radar-footnote">*Quantidade exibida pela busca pública pode ser referencial.</p>
      </section>` : `
      <section class="radar-section"><div class="radar-section-title">Referência de mercado</div><div class="check-row check-alerta">Não encontrei uma amostra comparável suficiente para este anúncio.</div></section>`;

    let marginHtml = '';
    if (productCost === null) {
      marginHtml = `
        <section class="radar-section">
          <div class="radar-section-title">Proteção de margem</div>
          <div class="check-row check-alerta">Informe o custo do produto no card do anúncio para o Radar calcular se o preço sugerido mantém lucro e margem.</div>
        </section>`;
    } else {
      marginHtml = `
        <section class="radar-section">
          <div class="radar-section-title">Proteção de margem</div>
          ${renderRadarMargin('No preço atual', data.margin?.current)}
          ${renderRadarMargin('No preço para ganhar', data.margin?.atPriceToWin)}
          ${data.margin?.atPriceToWin && data.margin.atPriceToWin.netProfit < 0 ? '<div class="radar-warning">Não reduza para o preço sugerido sem rever custos: a simulação ficaria no prejuízo.</div>' : ''}
          <p class="radar-note">Simulação usa custo informado no card, comissão de ${Number(globalSettings.commission).toFixed(1)}% e imposto de ${Number(globalSettings.tax).toFixed(1)}%. Frete, tarifa fixa e Ads estão em zero nesta simulação rápida.</p>
        </section>`;
    }

    body.innerHTML = `
      <h2>${escapeHtml(data.item.title)}</h2>
      <p class="radar-subtitle">Radar de Concorrência · ${escapeHtml(data.item.id)}</p>
      ${officialHtml}
      ${marketHtml}
      ${marginHtml}
    `;
  } catch (err) {
    body.innerHTML = `<h2>Radar de Concorrência</h2><p class="check-critico">Erro ao consultar o Radar. Veja o console para detalhes.</p>`;
    console.error(err);
  }
}

async function openAIAnalysis(itemId) {
  const modal = document.getElementById('diagnosis-modal');
  const body = document.getElementById('modal-body');

  body.innerHTML = `
    <h2>Análise profunda com IA</h2>
    <p style="color:var(--text-dim);font-size:14px">Buscando concorrentes e analisando o anúncio (pode levar alguns segundos)…</p>
  `;
  modal.hidden = false;

  try {
    const res = await fetch(`/api/items/${itemId}/deep-analysis`);
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    const data = await res.json();

    if (data.error) {
      body.innerHTML = `
        <h2>Análise profunda com IA</h2>
        <p class="check-critico">${escapeHtml(data.error)}</p>
      `;
      return;
    }

    const comp = data.competitorData;
    const compHtml = comp && comp.competitors.length > 0
      ? `<div class="check-row check-info">Comparado com ${comp.competitors.length} concorrentes: preço médio R$ ${comp.avgPrice}, ${comp.avgPictures} fotos em média, ${comp.freeShippingRate}% com frete grátis.</div>`
      : `<div class="check-row check-alerta">Não foi possível encontrar concorrentes comparáveis para essa categoria.</div>`;

    body.innerHTML = `
      <h2>${escapeHtml(data.title)}</h2>
      ${compHtml}
      <div style="white-space:pre-wrap;font-size:14px;line-height:1.6;margin-top:12px">${escapeHtml(data.analysis || '')}</div>
    `;
  } catch (err) {
    body.innerHTML = `
      <h2>Análise profunda com IA</h2>
      <p class="check-critico">Erro ao gerar análise. Veja o console para detalhes.</p>
    `;
    console.error(err);
  }
}

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('diagnosis-modal').hidden = true;
});

document.getElementById('calc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const payload = Object.fromEntries([...form.entries()].map(([k, v]) => [k, Number(v)]));

  const res = await fetch('/api/calculator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await res.json();
  const resultEl = document.getElementById('calc-result');

  if (result.error) {
    resultEl.innerHTML = `<p class="check-critico">${escapeHtml(result.error)}</p>`;
    return;
  }

  resultEl.innerHTML = `
    <div class="big-number" style="color:${result.netProfit >= 0 ? 'var(--accent)' : 'var(--danger)'}">
      Lucro: R$ ${result.netProfit.toFixed(2)} (${result.marginPercent.toFixed(1)}%)
    </div>
    <div class="row"><span>Custo do produto</span><span>R$ ${result.breakdown.productCost.toFixed(2)}</span></div>
    <div class="row"><span>Comissão ML</span><span>R$ ${result.breakdown.commissionValue.toFixed(2)}</span></div>
    <div class="row"><span>Frete</span><span>R$ ${result.breakdown.shippingCost.toFixed(2)}</span></div>
    <div class="row"><span>Tarifa fixa</span><span>R$ ${result.breakdown.fixedFee.toFixed(2)}</span></div>
    <div class="row"><span>Imposto</span><span>R$ ${result.breakdown.taxValue.toFixed(2)}</span></div>
    <div class="row"><span>Ads</span><span>R$ ${result.breakdown.adsValue.toFixed(2)}</span></div>
    <div class="row"><span>Preço mínimo (breakeven)</span><span>R$ ${result.breakevenPrice.toFixed(2)}</span></div>
  `;
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

(async function initVisiumDashboard() {
  await Promise.all([loadPlatformActions(), loadMarketplaceAccounts()]);
  await loadOverview();
  if (activeMarketplacePlatform === 'mercadolivre') {
    loadItems();
    loadCategories();
  }
})();

// ---------- Financeiro ----------

document.getElementById('financials-days').addEventListener('change', loadFinancials);

async function loadFinancials() {
  const statusEl = document.getElementById('financials-status');
  const contentEl = document.getElementById('financials-content');
  const days = document.getElementById('financials-days').value;

  statusEl.hidden = false;
  statusEl.textContent = 'Carregando dados financeiros…';
  contentEl.hidden = true;

  try {
    const res = await fetch(`/api/financials?days=${days}`);
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    const data = await res.json();

    if (data.error) {
      statusEl.textContent = data.error;
      return;
    }

    document.getElementById('fin-revenue').textContent = `R$ ${data.totalRevenue.toFixed(2)}`;
    document.getElementById('fin-orders').textContent = data.orderCount;
    document.getElementById('fin-ticket').textContent = `R$ ${data.averageTicket.toFixed(2)}`;

    const topItemsEl = document.getElementById('fin-top-items');
    if (data.topItems.length === 0) {
      topItemsEl.innerHTML = '<p style="color:var(--text-dim);font-size:14px">Nenhuma venda paga nesse período.</p>';
    } else {
      topItemsEl.innerHTML = data.topItems
        .map(
          (item, i) => `
          <div class="row" style="padding:10px 0">
            <span>${i + 1}. ${escapeHtml(item.title)} <span style="color:var(--text-dim)">(${item.units} un.)</span></span>
            <span style="color:var(--primary);font-weight:700">R$ ${item.revenue.toFixed(2)}</span>
          </div>`
        )
        .join('');
    }

    statusEl.hidden = true;
    contentEl.hidden = false;
  } catch (err) {
    statusEl.textContent = 'Erro ao carregar dados financeiros. Veja o console para detalhes.';
    console.error(err);
  }
}

// ---------- Perguntas pendentes do Mercado Livre ----------

async function loadQuestions() {
  const statusEl = document.getElementById('questions-status');
  const listEl = document.getElementById('questions-list');

  statusEl.hidden = false;
  statusEl.textContent = 'Carregando perguntas…';
  listEl.hidden = true;

  try {
    const res = await fetch('/api/questions');
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    const data = await res.json();

    if (!data.questions || data.questions.length === 0) {
      statusEl.textContent = 'Nenhuma pergunta pendente de resposta. Tudo em dia! 🎉';
      return;
    }

    listEl.innerHTML = data.questions
      .map(
        (q) => `
        <div class="calc-form" style="max-width:none;display:block;padding:18px 20px">
          <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:10px">
            ${q.itemThumbnail ? `<img src="${fixThumb(q.itemThumbnail)}" alt="" style="width:48px;height:48px;object-fit:contain;background:#fff;border-radius:4px;flex-shrink:0" />` : ''}
            <div>
              <div style="font-size:12px;color:var(--text-dim)">${escapeHtml(q.itemTitle)}</div>
              <div style="font-size:15px;margin-top:4px">${escapeHtml(q.text)}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <input type="text" class="answer-input" data-question-id="${q.id}" placeholder="Digite a resposta…" style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:9px 12px;border-radius:3px;font-size:14px" />
            <button class="link-btn answer-btn" data-question-id="${q.id}" style="width:auto;padding:9px 18px">Responder</button>
          </div>
          <p class="answer-feedback" data-question-id="${q.id}" style="font-size:12px;margin-top:6px;display:none"></p>
        </div>`
      )
      .join('');

    listEl.querySelectorAll('.answer-btn').forEach((btn) => {
      btn.addEventListener('click', () => submitAnswer(btn.dataset.questionId));
    });

    statusEl.hidden = true;
    listEl.hidden = false;
  } catch (err) {
    statusEl.textContent = 'Erro ao carregar perguntas. Veja o console para detalhes.';
    console.error(err);
  }
}

async function submitAnswer(questionId) {
  const input = document.querySelector(`.answer-input[data-question-id="${questionId}"]`);
  const btn = document.querySelector(`.answer-btn[data-question-id="${questionId}"]`);
  const feedback = document.querySelector(`.answer-feedback[data-question-id="${questionId}"]`);
  const text = input.value.trim();

  if (!text) {
    input.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Enviando…';

  try {
    const res = await fetch(`/api/questions/${questionId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();

    if (res.ok && data.ok) {
      const card = btn.closest('.calc-form');
      card.style.opacity = '0.4';
      feedback.style.color = 'var(--primary)';
      feedback.textContent = 'Resposta enviada!';
      feedback.style.display = 'block';
      input.disabled = true;
      btn.textContent = 'Respondido';
    } else {
      feedback.style.color = 'var(--danger)';
      feedback.textContent = data.error || 'Falha ao enviar.';
      feedback.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Responder';
    }
  } catch (err) {
    feedback.style.color = 'var(--danger)';
    feedback.textContent = 'Erro de conexão.';
    feedback.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Responder';
  }
}

// ---------- Explorador de categorias do Mercado Livre ----------

let exploreLoadedOnce = false;
let exploreHistory = []; // pilha de ids visitados, para o breadcrumb clicável

function formatNumber(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('pt-BR');
}

function representationColor(repr) {
  if (repr === null) return { bg: 'var(--surface-alt)', bgSoft: 'transparent', text: 'var(--text-dim)' };
  // Interpola de cinza-azulado (baixa relevância) até verde-neon (alta),
  // passando por amarelo no meio — degradê continuo em vez de 3 faixas fixas.
  const pct = Math.max(0, Math.min(100, repr)) / 100;
  let r, g, b;
  if (pct < 0.5) {
    // cinza-azulado (#4a5568) -> amarelo (#e0b13c)
    const t = pct / 0.5;
    r = Math.round(74 + t * (224 - 74));
    g = Math.round(85 + t * (177 - 85));
    b = Math.round(104 + t * (60 - 104));
  } else {
    // amarelo (#e0b13c) -> verde-neon (#c6ff00)
    const t = (pct - 0.5) / 0.5;
    r = Math.round(224 + t * (198 - 224));
    g = Math.round(177 + t * (255 - 177));
    b = Math.round(60 + t * (0 - 60));
  }
  const bg = `rgb(${r},${g},${b})`;
  const bgSoft = `rgba(${r},${g},${b},0.16)`;
  // Texto escuro em fundos claros/verdes, texto claro em fundos escuros/cinza
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const text = luminance > 0.55 ? '#0a0a0a' : '#f5f5f5';
  return { bg, bgSoft, text };
}

async function loadExploreCategories(parentId) {
  const statusEl = document.getElementById('explore-status');
  const gridEl = document.getElementById('explore-grid');
  const currentEl = document.getElementById('explore-current');
  const breadcrumbEl = document.getElementById('explore-breadcrumb');

  statusEl.hidden = false;
  statusEl.textContent = 'Carregando categorias…';
  gridEl.hidden = true;
  currentEl.hidden = true;

  try {
    const url = parentId ? `/api/explore/categories?parent=${encodeURIComponent(parentId)}` : '/api/explore/categories';
    const res = await fetch(url);
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    const data = await res.json();

    if (!res.ok) {
      statusEl.hidden = false;
      statusEl.textContent = data.error || `Erro ao carregar categorias (status ${res.status}). Veja o console para detalhes.`;
      console.error('Erro na API de explorar categorias:', data);
      return;
    }

    // Breadcrumb
    if (data.breadcrumb && data.breadcrumb.length > 0) {
      const crumbs = [`<button data-parent="">Início</button>`]
        .concat(data.breadcrumb.map((c) => `<button data-parent="${c.id}">${escapeHtml(c.name)}</button>`));
      breadcrumbEl.innerHTML = crumbs.join('<span class="sep">/</span>');
      breadcrumbEl.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => loadExploreCategories(btn.dataset.parent || null));
      });
    } else {
      breadcrumbEl.innerHTML = '';
    }

    // Card da categoria atual
    if (data.current) {
      currentEl.hidden = false;
      currentEl.innerHTML = `
        <h3>${escapeHtml(data.current.name)}</h3>
        <span class="market-size"><strong>${formatNumber(data.current.total)}</strong> produtos cadastrados nessa categoria no Mercado Livre</span>
      `;
    }

    if (!data.children || data.children.length === 0) {
      statusEl.hidden = false;
      statusEl.textContent = 'Essa categoria não tem subcategorias — chegou no nível mais específico.';
      return;
    }

    gridEl.innerHTML = data.children
      .map((cat) => {
        const { bg, bgSoft, text } = representationColor(cat.representation);
        const bgStyle =
          cat.representation !== null
            ? `background: linear-gradient(135deg, ${bgSoft} 0%, var(--surface) 55%); border-left:4px solid ${bg};`
            : `border-left:4px solid ${bg};`;
        return `
        <button class="explore-card" data-id="${cat.id}" style="${bgStyle}">
          <span class="cat-name">${escapeHtml(cat.name)}</span>
          <span class="cat-total">${formatNumber(cat.total)} produtos</span>
          ${cat.representation !== null ? `<span class="cat-representation" style="background:${bg};color:${text}">${cat.representation}%</span>` : ''}
        </button>`;
      })
      .join('');

    gridEl.querySelectorAll('.explore-card').forEach((card) => {
      card.addEventListener('click', () => loadExploreCategories(card.dataset.id));
    });

    statusEl.hidden = true;
    gridEl.hidden = false;
  } catch (err) {
    statusEl.hidden = false;
    statusEl.textContent = 'Erro ao carregar categorias. Veja o console para detalhes.';
    console.error(err);
  }
}
