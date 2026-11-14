/* UC Topup — core: shared state, API client, UI helpers, cart and theme */
(() => {
  'use strict';

  const UC = (window.UC = window.UC || {});
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { config: null, user: null, fmt: null, catalog: null, catalogAt: 0, returnTo: null };
  const CART_KEY = 'uc.cart.v1';
  const THEME_KEY = 'uc.theme';
  const MAX_QTY = 10;

  const money = (cents) => state.fmt.format(Number(cents) / 100);
  const ucFmt = (n) => `${Number(n).toLocaleString()} UC`;
  const dateFmt = (s) => {
    const str = String(s);
    const iso = str.includes('T') ? str : str.replace(' ', 'T') + 'Z';
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };
  const go = (hash) => (location.hash === hash ? UC.route() : (location.hash = hash));

  // ---------- API ----------

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      /* empty body */
    }
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /** Full, unfiltered catalog, cached for 60 seconds. Used by the cart and product lookups. */
  async function catalog(force = false) {
    if (!force && state.catalog && Date.now() - state.catalogAt < 60000) return state.catalog;
    state.catalog = await api('/catalog');
    state.catalogAt = Date.now();
    return state.catalog;
  }

  const findProduct = (id) => state.catalog && state.catalog.products.find((p) => p.id === id);
  const isCosmetic = (product) => {
    if (!product || !state.catalog) return false;
    const cat = state.catalog.categories.find((c) => c.slug === product.category);
    return !!cat && cat.fulfilment === 'cosmetic';
  };

  // ---------- Cart (per-browser; the server re-prices everything at checkout) ----------

  const cart = {
    items() {
      try {
        const v = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
        return Array.isArray(v) ? v.filter((i) => Number.isInteger(i.id) && Number.isInteger(i.qty) && i.qty > 0) : [];
      } catch (_) {
        return [];
      }
    },
    save(items) {
      try {
        localStorage.setItem(CART_KEY, JSON.stringify(items));
      } catch (_) {
        /* storage blocked: cart still works for this page view */
      }
      renderCartBadge();
      document.dispatchEvent(new CustomEvent('cart:change'));
    },
    add(id) {
      const items = cart.items();
      const line = items.find((i) => i.id === id);
      const product = findProduct(id);
      if (line) {
        if (isCosmetic(product)) return 'exists';
        line.qty = Math.min(MAX_QTY, line.qty + 1);
      } else {
        items.push({ id, qty: 1 });
      }
      cart.save(items);
      return 'added';
    },
    setQty(id, qty) {
      const items = cart.items();
      const line = items.find((i) => i.id === id);
      if (!line) return;
      const cap = isCosmetic(findProduct(id)) ? 1 : MAX_QTY;
      line.qty = Math.max(1, Math.min(cap, qty));
      cart.save(items);
    },
    remove(id) {
      cart.save(cart.items().filter((i) => i.id !== id));
    },
    clear(ids) {
      cart.save(ids ? cart.items().filter((i) => !ids.includes(i.id)) : []);
    },
    count() {
      return cart.items().reduce((sum, i) => sum + i.qty, 0);
    },
  };

  function renderCartBadge() {
    const el = $('#cart-count');
    if (!el) return;
    const n = cart.count();
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = n === 0;
    $('#cart-btn')?.setAttribute('aria-label', `Open cart, ${n} item${n === 1 ? '' : 's'}`);
  }

  // ---------- Theme ----------

  const ICON_SUN =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ICON_MOON =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const btn = $('#theme-btn');
    if (!btn) return;
    const next = theme === 'dark' ? 'light' : 'dark';
    btn.innerHTML = theme === 'dark' ? ICON_SUN : ICON_MOON;
    btn.setAttribute('aria-label', `Switch to ${next} theme`);
    btn.title = `Switch to ${next} theme`;
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (_) {
      /* storage blocked */
    }
    applyTheme(next);
  }

  function initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch (_) {
      /* storage blocked */
    }
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(saved || (prefersLight ? 'light' : 'dark'));
  }

  // ---------- Header state ----------

  function renderNav() {
    const authed = !!state.user;
    document.body.classList.toggle('is-authed', authed);
    document.body.classList.toggle('is-guest', !authed);
    $('#nav-balance').textContent = authed ? money(state.user.balance_cents) : '';
  }

  function closeNav() {
    $('#nav-links').classList.remove('open');
    $('[data-nav-toggle]').setAttribute('aria-expanded', 'false');
  }

  // ---------- UI helpers ----------

  let toastTimer;
  function toast(message, type = 'ok') {
    const el = $('#toast');
    el.textContent = message;
    el.className = `toast show toast-${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 3500);
  }

  const setView = (html) => {
    $('#app').innerHTML = html;
  };

  const showError = (el, message) => {
    el.textContent = message;
    el.hidden = false;
  };

  /** Connects a form to an async handler, with a busy state and inline errors. */
  function bindForm(formId, errorId, handler) {
    const form = $(`#${formId}`);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $(`#${errorId}`);
      errEl.hidden = true;
      const btn = form.querySelector('button[type="submit"]');
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Please wait…';
      try {
        await handler(Object.fromEntries(new FormData(form)), form);
      } catch (err) {
        showError(errEl, err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });
  }

  let lastFocus = null;
  function onEscape(e) {
    if (e.key === 'Escape') closeModal();
  }
  function trapFocus(e) {
    if (e.key !== 'Tab') return;
    const items = [...e.currentTarget.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea')];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function openModal(html, onMount, { label = 'Dialog' } = {}) {
    closeModal(true);
    lastFocus = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal card" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.closest('[data-close]')) closeModal();
    });
    backdrop.addEventListener('keydown', trapFocus);
    document.body.appendChild(backdrop);
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', onEscape);
    const focusTarget = backdrop.querySelector('[data-autofocus], input, button') || backdrop.firstElementChild;
    focusTarget.focus();
    onMount?.(backdrop);
    return backdrop;
  }

  function closeModal(silent = false) {
    document.querySelectorAll('.modal-backdrop').forEach((n) => n.remove());
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', onEscape);
    if (!silent && lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  Object.assign(UC, {
    $,
    esc,
    state,
    money,
    ucFmt,
    dateFmt,
    go,
    api,
    catalog,
    findProduct,
    isCosmetic,
    cart,
    renderCartBadge,
    toggleTheme,
    initTheme,
    renderNav,
    closeNav,
    toast,
    setView,
    showError,
    bindForm,
    openModal,
    closeModal,
    MAX_QTY,
    route: () => {},
  });
})();
