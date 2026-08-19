document.getElementById('forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const messageEl = document.getElementById('forgot-message');
  const btn = e.target.querySelector('button');
  btn.disabled = true;

  try {
    await fetch('/user/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    messageEl.style.color = 'var(--primary)';
    messageEl.textContent = 'Se esse e-mail tiver uma conta, o link de redefinição foi enviado. Confira sua caixa de entrada.';
    messageEl.style.display = 'block';
  } catch (err) {
    messageEl.style.color = 'var(--danger)';
    messageEl.textContent = 'Erro de conexão. Tente novamente.';
    messageEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
});
