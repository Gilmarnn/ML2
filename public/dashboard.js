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
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
};

function fixThumb(url) {
  // A API do ML às vezes devolve o thumbnail em http:// puro, o que o navegador
  // bloqueia como conteúdo misto numa página https. Forçamos https aqui.
  if (!url) return '';
  return url.replace(/^http:\/\//, 'https://');
}

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
        return `
        <article class="item-card">
          <div class="item-card-thumb">
            ${thumb ? `<img src="${thumb}" alt="" loading="lazy" />` : ''}
            <span class="item-card-score score-pill ${scoreClass(item.diagnosis.score)}">${item.diagnosis.score}</span>
          </div>
          <div class="item-card-body">
            <div class="item-card-title">${escapeHtml(item.title)}</div>
            <div class="item-card-price">R$ ${Number(item.price).toFixed(2)}</div>
            <div class="item-card-stats">
              <span class="item-card-stat ${stockZero ? 'stat-zero' : ''}" title="Estoque">${ICONS.box} ${item.available_quantity}</span>
              <span class="item-card-stat ${visitsZero ? 'stat-zero' : ''}" title="Visitas em 30 dias">${ICONS.eye} ${item.visits ?? '—'}</span>
            </div>
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
