document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value;
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('register-error');
  errorEl.style.display = 'none';

  try {
    const res = await fetch('/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();

    if (res.ok && data.ok) {
      // Conta criada (assinatura ainda pendente) — manda direto pra tela de pagamento.
      window.location.href = '/subscribe.html';
    } else {
      errorEl.textContent = data.error || 'Não foi possível criar a conta.';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.textContent = 'Erro de conexão. Tente novamente.';
    errorEl.style.display = 'block';
  }
});
