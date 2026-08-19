document.getElementById('cpf').addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 11);
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  e.target.value = v;
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value;
  const email = document.getElementById('email').value;
  const cpf = document.getElementById('cpf').value;
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('register-error');
  errorEl.style.display = 'none';

  try {
    const res = await fetch('/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, cpf, password })
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
