/* UC Topup — storefront: catalog, product details, cart drawer and checkout */
(() => {
  'use strict';

  const UC = window.UC;
  const { $, esc, money, ucFmt, api, cart, toast, setView, state } = UC;

  const RARITY_LABEL = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
  const ICONS = {
    uc: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    suits:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3 3 6l2 4 2-1v10h10V9l2 1 2-4-5-3c-1 2-7 2-8 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    'car-skins':
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14l2-5h14l2 5v3H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="7" cy="17.5" r="1.8" fill="currentColor"/><circle cx="17" cy="17.5" r="1.8" fill="currentColor"/></svg>',
  };
  const iconFor = (category) => ICONS[category] || ICONS.uc;

  const filters = { category: '', q: '', rarity: '', sort: 'featured' };
  let reqSeq = 0;
  let searchTimer;

  const isOpen = () => !$('#cart-drawer').hidden;

  // ---------- Catalog ----------

  const productCard = (p) => `
    <article class="product card tone-${esc(p.rarity)}">
      <button class="product-open" type="button" data-open="${Number(p.id)}" aria-label="View details for ${esc(p.name)}">
        <div class="tile tile-${esc(p.category)}">${iconFor(p.category)}</div>
        <div class="product-body">
          <span class="rarity rarity-${esc(p.rarity)}">${RARITY_LABEL[p.rarity] || esc(p.rarity)}</span>
          ${p.popular ? '<span class="pill">Popular</span>' : ''}
          <h3>${esc(p.name)}</h3>
          <p class="muted small">${esc(p.description)}</p>
        </div>
      </button>
      <div class="product-foot">
        <span class="price">${esc(money(p.price_cents))}</span>
        <button class="btn btn-primary btn-sm" type="button" data-add="${Number(p.id)}">Add to cart</button>
      </div>
    </article>`;

  const skeletons = Array.from({ length: 6 }, () => '<div class="card product skeleton" aria-hidden="true"></div>').join('');

  async function viewShop() {
    const cat = await UC.catalog();
    const tabs = [{ slug: '', name: 'All items' }, ...cat.categories];

    setView(`
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Fast checkout · Wallet payments · Refund on failed delivery</p>
          <h1>Level up your loadout</h1>
          <p class="lead">UC top-ups, suits and car skins. Add what you want, check out once and track every item.</p>
          <div class="hero-cta">
            <button class="btn btn-primary btn-lg" type="button" data-scroll="catalog">Shop now</button>
            <a class="btn btn-ghost btn-lg" href="#/signup" data-guest>Create free account</a>
          </div>
        </div>
        <ul class="trust">
          <li><strong>Transparent pricing</strong><span>Prices are checked again at checkout</span></li>
          <li><strong>Item-level refunds</strong><span>If one item fails, only that item is refunded</span></li>
          <li><strong>Order tracking</strong><span>Every item has its own status</span></li>
        </ul>
      </section>

      <section class="section" id="catalog" aria-labelledby="catalog-h">
        <div class="section-head">
          <h2 id="catalog-h">Shop</h2>
          <p class="muted small" id="results-meta" aria-live="polite"></p>
        </div>

        <div class="tabs" role="group" aria-label="Categories" id="cat-tabs">
          ${tabs
            .map(
              (t) =>
                `<button type="button" class="tab" data-cat="${esc(t.slug)}" aria-pressed="${filters.category === t.slug}">${esc(t.name)}</button>`
            )
            .join('')}
        </div>

        <div class="toolbar">
          <label class="search">
            <span class="sr-only">Search items</span>
            <input type="search" id="q" placeholder="Search items" autocomplete="off" value="${esc(filters.q)}">
          </label>
          <label class="sr-only" for="rarity">Rarity</label>
          <select id="rarity">
            <option value="">All rarities</option>
            ${Object.entries(RARITY_LABEL)
              .map(([v, l]) => `<option value="${v}" ${filters.rarity === v ? 'selected' : ''}>${l}</option>`)
              .join('')}
          </select>
          <label class="sr-only" for="sort">Sort</label>
          <select id="sort">
            <option value="featured" ${filters.sort === 'featured' ? 'selected' : ''}>Featured</option>
            <option value="popular" ${filters.sort === 'popular' ? 'selected' : ''}>Most popular</option>
            <option value="price_asc" ${filters.sort === 'price_asc' ? 'selected' : ''}>Price: low to high</option>
            <option value="price_desc" ${filters.sort === 'price_desc' ? 'selected' : ''}>Price: high to low</option>
            <option value="newest" ${filters.sort === 'newest' ? 'selected' : ''}>Newest</option>
          </select>
        </div>

        <div class="product-grid" id="grid" aria-busy="true">${skeletons}</div>
      </section>`);

    $('#cat-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('[data-cat]');
      if (!tab) return;
      filters.category = tab.dataset.cat;
      document.querySelectorAll('#cat-tabs .tab').forEach((t) => t.setAttribute('aria-pressed', String(t === tab)));
      loadGrid();
    });
    $('#q').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        filters.q = e.target.value.trim();
        loadGrid();
      }, 250);
    });
    $('#rarity').addEventListener('change', (e) => {
      filters.rarity = e.target.value;
      loadGrid();
    });
    $('#sort').addEventListener('change', (e) => {
      filters.sort = e.target.value;
      loadGrid();
    });

    await loadGrid();
  }

  async function loadGrid() {
    const seq = ++reqSeq;
    const params = new URLSearchParams({ sort: filters.sort });
    if (filters.category) params.set('category', filters.category);
    if (filters.q) params.set('q', filters.q);
    if (filters.rarity) params.set('rarity', filters.rarity);

    const grid = $('#grid');
    grid.setAttribute('aria-busy', 'true');
    const { products } = await api(`/catalog?${params}`);
    if (seq !== reqSeq || !$('#grid')) return; // a newer request or a page change superseded this one

    $('#results-meta').textContent = `${products.length} item${products.length === 1 ? '' : 's'}`;
    grid.setAttribute('aria-busy', 'false');
    grid.innerHTML = products.length
      ? products.map(productCard).join('')
      : `<div class="card empty-state span-all">
           <p>No items match your filters.</p>
           <button class="btn btn-ghost" type="button" data-reset-filters>Clear filters</button>
         </div>`;
  }

  function resetFilters() {
    Object.assign(filters, { category: '', q: '', rarity: '', sort: 'featured' });
    if (!$('#grid')) return;
    $('#q').value = '';
    $('#rarity').value = '';
    $('#sort').value = 'featured';
    document.querySelectorAll('#cat-tabs .tab').forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.cat === '')));
    loadGrid();
  }

  // ---------- Product details ----------

  function addToCart(id) {
    const product = UC.findProduct(id);
    const name = product ? product.name : 'Item';
    const result = cart.add(id);
    if (result === 'exists') toast(`${name} is already in your cart. One per Player ID.`, 'info');
    else toast(`${name} added to your cart.`);
    return result;
  }

  async function openProduct(id) {
    await UC.catalog();
    const p = UC.findProduct(id);
    if (!p) return toast('That item is no longer available.', 'error');
    const cosmetic = UC.isCosmetic(p);
    const inCart = cart.items().some((i) => i.id === id);

    UC.openModal(
      `
      <div class="product-detail">
        <div class="tile tile-lg tile-${esc(p.category)}">${iconFor(p.category)}</div>
        <div>
          <span class="rarity rarity-${esc(p.rarity)}">${RARITY_LABEL[p.rarity] || esc(p.rarity)}</span>
          <h2>${esc(p.name)}</h2>
          <p class="muted">${esc(p.description)}</p>
          <p class="price-lg">${esc(money(p.price_cents))}</p>
          ${p.uc_amount ? `<p class="small muted">${esc(ucFmt(p.uc_amount))} credited to your Player ID.</p>` : ''}
          ${cosmetic ? '<p class="small muted">One per Player ID. Delivered to your Player ID after payment.</p>' : ''}
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Keep shopping</button>
        <button type="button" class="btn btn-primary" data-modal-add="${id}" ${inCart && cosmetic ? 'disabled' : ''}>
          ${inCart && cosmetic ? 'In cart' : 'Add to cart'}
        </button>
      </div>`,
      null,
      { label: p.name }
    );
  }

  // ---------- Cart drawer ----------

  function cartLine(line, p) {
    const cosmetic = UC.isCosmetic(p);
    return `
      <li class="cart-line">
        <div class="tile tile-sm tile-${esc(p.category)}">${iconFor(p.category)}</div>
        <div class="cart-line-body">
          <strong>${esc(p.name)}</strong>
          <span class="small muted">${p.uc_amount ? `${esc(ucFmt(p.uc_amount))} · ${esc(money(p.price_cents))} each` : `${esc(money(p.price_cents))} · one per Player ID`}</span>
          <div class="qty">
            ${
              cosmetic
                ? '<span class="small muted">Qty 1</span>'
                : `<button type="button" class="qty-btn" data-qty="${line.id}" data-delta="-1" aria-label="Decrease quantity">−</button>
                   <span class="qty-value" aria-live="polite">${line.qty}</span>
                   <button type="button" class="qty-btn" data-qty="${line.id}" data-delta="1" aria-label="Increase quantity" ${line.qty >= UC.MAX_QTY ? 'disabled' : ''}>+</button>`
            }
            <button type="button" class="link-btn" data-remove="${line.id}">Remove</button>
          </div>
        </div>
        <strong class="cart-line-price">${esc(money(p.price_cents * line.qty))}</strong>
      </li>`;
  }

  function resolvedLines() {
    return cart.items().map((line) => ({ line, p: UC.findProduct(line.id) })).filter((x) => x.p);
  }

  function renderCart() {
    const drawer = $('#cart-drawer');
    const stored = cart.items();
    const lines = resolvedLines();
    if (lines.length !== stored.length) cart.save(lines.map((x) => x.line)); // drop items no longer sold

    const total = lines.reduce((sum, { line, p }) => sum + p.price_cents * line.qty, 0);
    const balance = state.user ? state.user.balance_cents : 0;

    drawer.innerHTML = `
      <div class="drawer-backdrop" data-close-drawer></div>
      <div class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="cart-title">
        <header class="drawer-head">
          <h2 id="cart-title">Your cart <span class="muted small">${cart.count()} item${cart.count() === 1 ? '' : 's'}</span></h2>
          <button type="button" class="icon-btn" data-close-drawer aria-label="Close cart">×</button>
        </header>
        ${
          lines.length
            ? `<ul class="cart-lines">${lines.map(({ line, p }) => cartLine(line, p)).join('')}</ul>
               <footer class="drawer-foot">
                 <div class="sum-row"><span>Subtotal</span><strong>${esc(money(total))}</strong></div>
                 <p class="small muted">${state.user ? `Wallet balance: ${esc(money(balance))}` : 'Log in to pay from your wallet.'}</p>
                 <button type="button" class="btn btn-primary btn-block btn-lg" data-checkout>
                   ${state.user ? 'Checkout' : 'Log in to checkout'}
                 </button>
                 <button type="button" class="btn btn-ghost btn-block" data-clear-cart>Clear cart</button>
               </footer>`
            : `<div class="empty-state">
                 <p>Your cart is empty.</p>
                 <button type="button" class="btn btn-primary" data-close-drawer data-go-shop>Browse items</button>
               </div>`
        }
      </div>`;
  }

  async function openCart() {
    await UC.catalog().catch(() => {});
    renderCart();
    const drawer = $('#cart-drawer');
    drawer.hidden = false;
    document.body.classList.add('drawer-open');
    drawer.querySelector('.drawer-panel .icon-btn, .drawer-panel button').focus();
  }

  function closeCart() {
    const drawer = $('#cart-drawer');
    if (drawer.hidden) return;
    drawer.hidden = true;
    drawer.innerHTML = '';
    document.body.classList.remove('drawer-open');
    $('#cart-btn')?.focus();
  }

  function renderCartBar() {
    const bar = $('#cart-bar');
    const lines = resolvedLines();
    const count = cart.count();
    bar.hidden = count === 0 || !!document.querySelector('.modal-backdrop');
    document.body.classList.toggle('has-cart-bar', !bar.hidden);
    if (bar.hidden) return;
    const total = lines.reduce((sum, { line, p }) => sum + p.price_cents * line.qty, 0);
    bar.querySelector('[data-bar-text]').textContent = `${count} item${count === 1 ? '' : 's'} · ${money(total)}`;
  }

  // ---------- Checkout ----------

  function startCheckout() {
    if (!state.user) {
      state.returnTo = '#/';
      closeCart();
      toast('Log in to complete your purchase.', 'info');
      return UC.go('#/login');
    }

    const lines = resolvedLines();
    if (!lines.length) return;
    const total = lines.reduce((sum, { line, p }) => sum + p.price_cents * line.qty, 0);
    const enough = state.user.balance_cents >= total;
    // One reference per checkout attempt. A retry after a network error reuses it, so it can't charge twice.
    const clientRef = (crypto.randomUUID && crypto.randomUUID()) || `ref-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    closeCart();
    UC.openModal(
      `
      <h2>Confirm your order</h2>
      <ul class="summary-lines">
        ${lines
          .map(
            ({ line, p }) => `<li><span>${esc(p.name)}${line.qty > 1 ? ` × ${line.qty}` : ''}</span><span>${esc(money(p.price_cents * line.qty))}</span></li>`
          )
          .join('')}
      </ul>
      <dl class="summary">
        <div><dt>Total</dt><dd>${esc(money(total))}</dd></div>
        <div><dt>Wallet balance</dt><dd>${esc(money(state.user.balance_cents))}</dd></div>
      </dl>
      <form id="co-form" novalidate>
        <div class="field">
          <label for="co-pubg">PUBG Player ID</label>
          <input id="co-pubg" name="pubg_id" inputmode="numeric" autocomplete="off" maxlength="15"
                 value="${esc(state.user.pubg_id)}" placeholder="6–15 digits" required data-autofocus>
          <small class="hint">Everything in this order is delivered to this Player ID. Check it carefully.</small>
        </div>
        <p class="form-error" id="co-error" role="alert" hidden></p>
        ${enough ? '' : `<p class="form-error">You need ${esc(money(total - state.user.balance_cents))} more. <a href="#/profile" data-close>Add funds</a></p>`}
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary" id="co-submit" ${enough ? '' : 'disabled'}>
            Pay ${esc(money(total))} from wallet
          </button>
        </div>
      </form>`,
      (root) => {
        const form = $('#co-form', root);
        const btn = $('#co-submit', root);
        const errEl = $('#co-error', root);

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          errEl.hidden = true;
          const pubg = form.pubg_id.value.trim();
          if (!/^\d{6,15}$/.test(pubg)) return UC.showError(errEl, 'Enter a valid 6–15 digit Player ID.');

          const label = btn.textContent;
          btn.disabled = true;
          btn.textContent = 'Processing…';
          try {
            const data = await api('/checkout', {
              method: 'POST',
              body: {
                items: lines.map(({ line }) => ({ product_id: line.id, quantity: line.qty })),
                pubg_id: pubg,
                client_ref: clientRef,
              },
            });
            state.user.balance_cents = data.balance_cents;
            UC.renderNav();
            cart.clear(lines.map(({ line }) => line.id));
            UC.closeModal();
            announce(data.order);
            UC.go(`#/orders/${data.order.id}`);
          } catch (err) {
            UC.showError(errEl, err.message);
            if (err.data && err.data.balance_cents !== undefined) {
              state.user.balance_cents = err.data.balance_cents;
              UC.renderNav();
            }
            if (err.status === 404) UC.catalog(true).catch(() => {});
            btn.disabled = false;
            btn.textContent = label;
          }
        });
      },
      { label: 'Confirm your order' }
    );
  }

  function announce(order) {
    const count = order.items.length;
    if (order.status === 'delivered') toast(`Order #${order.id} complete. ${count} item${count === 1 ? '' : 's'} delivered.`);
    else if (order.status === 'refunded') toast(`Order #${order.id}: delivery failed. Your wallet was refunded.`, 'error');
    else toast(`Order #${order.id}: some items failed and were refunded.`, 'error');
  }

  // ---------- Events ----------

  document.addEventListener('click', (e) => {
    const t = e.target;

    const add = t.closest('[data-add]');
    if (add) return addToCart(Number(add.dataset.add));

    const modalAdd = t.closest('[data-modal-add]');
    if (modalAdd) {
      const id = Number(modalAdd.dataset.modalAdd);
      if (addToCart(id) === 'added') UC.closeModal();
      renderCartBar();
      return;
    }

    const open = t.closest('[data-open]');
    if (open) return openProduct(Number(open.dataset.open));

    if (t.closest('[data-reset-filters]')) return resetFilters();

    if (t.closest('#cart-btn') || t.closest('[data-open-cart]')) return openCart();

    if (t.closest('[data-go-shop]')) return UC.go('#/');

    if (t.closest('#cart-drawer [data-close-drawer]')) return closeCart();

    if (t.closest('[data-checkout]')) return startCheckout();

    if (t.closest('[data-clear-cart]')) {
      cart.clear();
      return renderCart();
    }

    const qty = t.closest('[data-qty]');
    if (qty) {
      const id = Number(qty.dataset.qty);
      const line = cart.items().find((i) => i.id === id);
      if (line) cart.setQty(id, line.qty + Number(qty.dataset.delta));
      return renderCart();
    }

    const remove = t.closest('[data-remove]');
    if (remove) {
      cart.remove(Number(remove.dataset.remove));
      return renderCart();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closeCart();
  });

  document.addEventListener('cart:change', () => {
    if (isOpen()) renderCart();
    renderCartBar();
  });

  UC.viewShop = viewShop;
  UC.openCart = openCart;
  UC.closeCart = closeCart;
  UC.renderCartBar = renderCartBar;
  UC.resetShopFilters = () => Object.assign(filters, { category: '', q: '', rarity: '', sort: 'featured' });
})();
