const tabItems = document.getElementById('tab-items');
const tabCalc = document.getElementById('tab-calc');
const panelItems = document.getElementById('panel-items');
const panelCalc = document.getElementById('panel-calc');

tabItems.addEventListener('click', () => switchTab('items'));
tabCalc.addEventListener('click', () => switchTab('calc'));

function switchTab(tab) {
  const isItems = tab === 'items';
  panelItems.hidden = !isItems;
  panelCalc.hidden = isItems;
  tabItems.classList.toggle('active', isItems);
  tabCalc.classList.toggle('active', !isItems);
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
  truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62L18.3 8.38A1 1 0 0 0 17.52 8H14"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>'
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
    const res = await fetch(`/api/items?offset=${currentOffset}&limit=30`);
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
            <div class="item-card-footer">
              <button class="link-btn" data-id="${item.id}">Ver diagnóstico</button>
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

loadItems();
