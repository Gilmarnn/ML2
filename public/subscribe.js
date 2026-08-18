document.getElementById('subscribe-btn').addEventListener('click', async () => {
  const btn = document.getElementById('subscribe-btn');
  const errorEl = document.getElementById('subscribe-error');
  errorEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Preparando pagamento…';

  try {
    const res = await fetch('/subscription/checkout', { method: 'POST' });
    const data = await res.json();

    if (res.ok && data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
    } else {
      errorEl.textContent = data.error || 'Não foi possível iniciar o pagamento.';
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Assinar agora';
    }
  } catch (err) {
    errorEl.textContent = 'Erro de conexão. Tente novamente.';
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Assinar agora';
  }
});

document.getElementById('check-status-link').addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const res = await fetch('/subscription/status');
    const data = await res.json();
    if (data.status === 'authorized') {
      window.location.href = '/dashboard.html';
    } else {
      alert('Ainda não identificamos o pagamento. Se você acabou de pagar, aguarde alguns segundos e tente de novo — a confirmação chega automaticamente.');
    }
  } catch (err) {
    alert('Erro ao verificar status. Tente novamente.');
  }
});
