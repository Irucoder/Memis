'use strict';

// Sesión que viaja con la página: se guarda al entrar y se manda en cada pedido
// a /api/. No depende de que el navegador acepte cookies (apps de WhatsApp o
// Instagram, vistas previas, bloqueo de cookies…), que era lo que hacía que a
// veces el sitio "te sacara" apenas entrabas.
(function () {
  const KEY = 'memis_token';
  const store = (fn) => { try { return fn(); } catch { return null; } };

  window.memisSession = {
    get: () => store(() => sessionStorage.getItem(KEY)) || store(() => localStorage.getItem(KEY)),
    set(token) {
      store(() => sessionStorage.setItem(KEY, token));
      store(() => localStorage.setItem(KEY, token));
    },
    clear() {
      store(() => sessionStorage.removeItem(KEY));
      store(() => localStorage.removeItem(KEY));
    },
  };

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const token = window.memisSession.get();
    if (token && /^\/api\//.test(new URL(url, location.href).pathname)) {
      const headers = new Headers(init.headers || (typeof input === 'string' ? {} : input.headers));
      if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
      init = { ...init, headers };
    }
    return nativeFetch(input, init);
  };
})();
