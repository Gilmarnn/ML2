document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.style.display = 'none';

  try {
    const res = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (res.ok && data.ok) {
      window.location.href = '/';
    } else {
      errorEl.textContent = data.error || 'Não foi possível entrar.';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.textContent = 'Erro de conexão. Tente novamente.';
    errorEl.style.display = 'block';
  }
});
