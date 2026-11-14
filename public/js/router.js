/* UC Topup — hash router, global controls and app boot. Load last. */
(() => {
  'use strict';

  const UC = window.UC;
  const { $, state, api, toast, setView, go } = UC;

  const routes = [
    { match: /^\/$/, view: () => UC.viewShop() },
    { match: /^\/login$/, view: () => UC.viewLogin(), guest: true },
    { match: /^\/signup$/, view: () => UC.viewSignup(), guest: true },
    { match: /^\/profile$/, view: () => UC.viewProfile(), auth: true },
    { match: /^\/orders$/, view: () => UC.viewOrders(), auth: true },
    { match: /^\/orders\/(\d+)$/, view: (m) => UC.viewOrder(Number(m[1])), auth: true },
  ];

  const currentPath = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];

  async function route() {
    UC.closeNav();
    UC.closeModal(true);
    if (!$('#cart-drawer').hidden) UC.closeCart();

    const path = currentPath();
    const r = routes.find((x) => x.match.test(path));

    if (!r) {
      return setView(`
        <section class="card empty-state">
          <h1 class="h2">Page not found</h1>
          <p class="muted">That page doesn't exist.</p>
          <a class="btn btn-primary" href="#/">Go to the shop</a>
        </section>`);
    }
    if (r.auth && !state.user) {
      state.returnTo = location.hash || '#/profile';
      toast('Please log in to continue.', 'info');
      return go('#/login');
    }
    if (r.guest && state.user) return go('#/profile');

    window.scrollTo({ top: 0, behavior: 'auto' });
    try {
      await r.view(path.match(r.match));
    } catch (err) {
      setView(`
        <section class="card empty-state">
          <p class="form-error">${UC.esc(err.message)}</p>
          <a class="btn btn-ghost" href="#/">Back to the shop</a>
        </section>`);
    }
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (_) {
      /* we clear local state either way */
    }
    state.user = null;
    UC.renderNav();
    toast('You have been logged out.', 'info');
    go('#/');
  }

  document.addEventListener('click', (e) => {
    const t = e.target;

    if (t.closest('[data-nav-toggle]')) {
      const open = $('#nav-links').classList.toggle('open');
      $('[data-nav-toggle]').setAttribute('aria-expanded', String(open));
      return;
    }
    if (t.closest('#logout-btn')) return logout();
    if (t.closest('#theme-btn')) return UC.toggleTheme();

    const scroll = t.closest('[data-scroll]');
    if (scroll) {
      document.getElementById(scroll.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  async function init() {
    UC.initTheme();
    $('#year').textContent = new Date().getFullYear();

    state.config = await api('/config');
    state.fmt = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: state.config.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    $('#brand').textContent = state.config.brand;
    $('.footer-brand').textContent = state.config.brand;
    document.title = state.config.brand;

    try {
      state.user = (await api('/auth/me')).user;
    } catch (_) {
      state.user = null;
    }

    await UC.catalog().catch(() => null);
    UC.renderNav();
    UC.renderCartBadge();
    UC.renderCartBar();

    UC.route = route;
    window.addEventListener('hashchange', route);
    route();
  }

  init().catch(() => {
    setView('<section class="card empty-state"><p class="form-error">Could not reach the server. Please refresh the page.</p></section>');
  });
})();
