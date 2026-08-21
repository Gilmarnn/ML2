(function () {
  function initPasswordToggles() {
    document.querySelectorAll('.password-toggle-btn').forEach(function (btn) {
      if (btn.dataset.toggleReady === '1') return;
      btn.dataset.toggleReady = '1';
      btn.addEventListener('click', function () {
        var wrap = btn.closest('.password-toggle-wrap');
        var input = wrap ? wrap.querySelector('input') : null;
        if (!input) return;
        var willShow = input.type === 'password';
        input.type = willShow ? 'text' : 'password';
        btn.textContent = willShow ? '🙈' : '👁';
        btn.setAttribute('aria-label', willShow ? 'Ocultar senha' : 'Mostrar senha');
        btn.setAttribute('title', willShow ? 'Ocultar senha' : 'Mostrar senha');
        btn.setAttribute('aria-pressed', willShow ? 'true' : 'false');
      });
    });
  }
  initPasswordToggles();
})();
