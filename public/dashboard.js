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

let loadedItems = [];
let currentOffset = 0;
let totalItems = null;

async function loadItems(isFirstPage = true) {
  const statusEl = document.getElementById('items-status');
  const table = document.getElementById('items-table');
  const tbody = document.getElementById('items-tbody');
  const loadMoreWrap = document.getElementById('load-more-wrap');
  const loadMoreBtn = document.getElementById('load-more-btn');
  const loadMoreCount = document.getElementById('load-more-count');

  if (isFirstPage) {
    statusEl.hidden = false;
    statusEl.textContent = 'Carregando anúncios…';
    table.hidden = true;
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

    const rowsHtml = data.items
      .map(
        (item) => `
        <tr>
          <td>${escapeHtml(item.title)}</td>
          <td>R$ ${Number(item.price).toFixed(2)}</td>
          <td>${item.available_quantity}</td>
          <td>${item.visits ?? '—'}</td>
          <td><span class="score-pill ${scoreClass(item.diagnosis.score)}">${item.diagnosis.score}</span></td>
          <td><button class="link-btn" data-id="${item.id}">Ver diagnóstico</button></td>
        </tr>`
      )
      .join('');

    tbody.insertAdjacentHTML('beforeend', rowsHtml);

    tbody.querySelectorAll('button[data-id]:not([data-bound])').forEach((btn) => {
      btn.setAttribute('data-bound', '1');
      btn.addEventListener('click', () => openDiagnosis(btn.dataset.id, loadedItems));
    });

    statusEl.hidden = true;
    table.hidden = false;

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
