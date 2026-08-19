const params = new URLSearchParams(window.location.search);
const token = params.get('token');

document.getElementById('reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const newPassword = document.getElementById('new-password').value;
  const messageEl = document.getElementById('reset-message');

  if (!token) {
    messageEl.style.color = 'var(--danger)';
    messageEl.textContent = 'Link inválido — falta o token. Peça um novo link em "esqueci minha senha".';
    messageEl.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/user/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword })
    });
    const data = await res.json();

    if (res.ok && data.ok) {
      messageEl.style.color = 'var(--primary)';
      messageEl.textContent = 'Senha redefinida! Redirecionando pro login…';
      messageEl.style.display = 'block';
      setTimeout(() => (window.location.href = '/login.html'), 1500);
    } else {
      messageEl.style.color = 'var(--danger)';
      messageEl.textContent = data.error || 'Falha ao redefinir a senha.';
      messageEl.style.display = 'block';
    }
  } catch (err) {
    messageEl.style.color = 'var(--danger)';
    messageEl.textContent = 'Erro de conexão. Tente novamente.';
    messageEl.style.display = 'block';
  }
});
