/* UC Topup — accounts: login, signup, profile and wallet, orders and receipts */
(() => {
  'use strict';

  const UC = window.UC;
  const { $, esc, money, ucFmt, dateFmt, api, toast, setView, state, bindForm, go } = UC;

  const PASSWORD_TOGGLE = (id) => `
    <div class="input-group">
      <input id="${id}" name="password" type="password" autocomplete="current-password" required>
      <button type="button" class="input-action" data-toggle-pass="${id}" aria-label="Show password" aria-pressed="false">Show</button>
    </div>`;

  const ITEM_STATUS = { processing: 'Processing', delivered: 'Delivered', refunded: 'Refunded' };
  const ORDER_STATUS = {
    processing: 'Processing',
    delivered: 'Delivered',
    partially_refunded: 'Partly refunded',
    refunded: 'Refunded',
  };

  // ---------- Auth ----------

  function viewLogin() {
    setView(`
      <section>
        <form class="card form-card" id="login-form" novalidate>
          <h1 class="h2">Welcome back</h1>
          <p class="muted">Log in to check out and track your orders.</p>
          <div class="field">
            <label for="l-email">Email</label>
            <input id="l-email" name="email" type="email" autocomplete="email" required data-autofocus>
          </div>
          <div class="field">
            <label for="l-pass">Password</label>
            ${PASSWORD_TOGGLE('l-pass')}
          </div>
          <p class="form-error" id="l-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Log in</button>
          <p class="muted center">New here? <a href="#/signup">Create an account</a></p>
        </form>
      </section>`);

    bindForm('login-form', 'l-error', async (f) => {
      const { user } = await api('/auth/login', { method: 'POST', body: { email: f.email, password: f.password } });
      state.user = user;
      UC.renderNav();
      const dest = state.returnTo || '#/profile';
      state.returnTo = null;
      toast(`Welcome back, ${user.name}.`);
      go(dest);
    });
  }

  function viewSignup() {
    setView(`
      <section>
        <form class="card form-card" id="signup-form" novalidate>
          <h1 class="h2">Create your account</h1>
          <p class="muted">Save your Player ID and check out in a few taps.</p>
          <div class="field">
            <label for="s-name">Full name</label>
            <input id="s-name" name="name" autocomplete="name" maxlength="60" required data-autofocus>
          </div>
          <div class="field">
            <label for="s-email">Email</label>
            <input id="s-email" name="email" type="email" autocomplete="email" maxlength="254" required>
          </div>
          <div class="field">
            <label for="s-pass">Password</label>
            ${PASSWORD_TOGGLE('s-pass').replace('autocomplete="current-password"', 'autocomplete="new-password" minlength="8" maxlength="128"')}
            <small class="hint">At least 8 characters.</small>
          </div>
          <div class="field">
            <label for="s-pubg">PUBG Player ID <span class="muted">(optional)</span></label>
            <input id="s-pubg" name="pubg_id" inputmode="numeric" maxlength="15" placeholder="6–15 digits">
          </div>
          <div class="field">
            <label for="s-phone">Phone <span class="muted">(optional)</span></label>
            <input id="s-phone" name="phone" type="tel" autocomplete="tel" maxlength="20">
          </div>
          <p class="form-error" id="s-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Create account</button>
          <p class="muted center">Already have an account? <a href="#/login">Log in</a></p>
        </form>
      </section>`);

    bindForm('signup-form', 's-error', async (f) => {
      const { user } = await api('/auth/signup', { method: 'POST', body: f });
      state.user = user;
      UC.renderNav();
      toast('Account created. Welcome!');
      go('#/profile');
    });
  }

  // ---------- Profile and wallet ----------

  async function viewProfile() {
    const wallet = await api('/wallet');
    const u = state.user;
    const demo = wallet.paymentMode === 'demo';

    const txnRows = wallet.transactions.length
      ? wallet.transactions
          .map(
            (t) => `
          <tr>
            <td data-label="Type"><span class="badge badge-${esc(t.type)}">${esc(t.type[0].toUpperCase() + t.type.slice(1))}</span></td>
            <td data-label="Amount" class="${t.amount_cents < 0 ? 'neg' : 'pos'}">${esc(money(t.amount_cents))}</td>
            <td data-label="Reference" class="muted">${esc(t.ref)}</td>
            <td data-label="Date">${esc(dateFmt(t.created_at))}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="4" class="muted">No wallet activity yet.</td></tr>';

    setView(`
      <div class="page-head">
        <h1 class="h1">My account</h1>
        <p class="muted">Hi ${esc(u.name)}. Manage your wallet and details here.</p>
      </div>

      <div class="grid-2">
        <section class="card" aria-labelledby="wallet-h">
          <h2 class="h3" id="wallet-h">Wallet</h2>
          <p class="balance" id="wallet-balance">${esc(money(wallet.balance_cents))}</p>
          ${
            demo
              ? `<p class="muted small">Demo mode: top-ups are credited instantly for testing. Connect a payment provider before going live.</p>
                 <div class="chip-row">
                   ${[5, 10, 25, 50].map((n) => `<button class="btn btn-ghost" type="button" data-topup="${n * 100}">+ ${esc(money(n * 100))}</button>`).join('')}
                 </div>`
              : '<p class="muted small">Online top-ups are not set up yet.</p>'
          }
        </section>

        <section class="card" aria-labelledby="acct-h">
          <h2 class="h3" id="acct-h">Account details</h2>
          <form id="profile-form" novalidate>
            <div class="field">
              <label for="p-name">Full name</label>
              <input id="p-name" name="name" value="${esc(u.name)}" maxlength="60" autocomplete="name" required>
            </div>
            <div class="field">
              <label for="p-email">Email</label>
              <input id="p-email" value="${esc(u.email)}" disabled>
            </div>
            <div class="field">
              <label for="p-phone">Phone</label>
              <input id="p-phone" name="phone" type="tel" value="${esc(u.phone)}" maxlength="20" autocomplete="tel">
            </div>
            <div class="field">
              <label for="p-pubg">PUBG Player ID</label>
              <input id="p-pubg" name="pubg_id" inputmode="numeric" value="${esc(u.pubg_id)}" maxlength="15" placeholder="6–15 digits">
              <small class="hint">Used as the default delivery ID at checkout.</small>
            </div>
            <p class="form-error" id="profile-error" role="alert" hidden></p>
            <button class="btn btn-primary" type="submit">Save changes</button>
          </form>
        </section>

        <section class="card" aria-labelledby="pw-h">
          <h2 class="h3" id="pw-h">Change password</h2>
          <form id="pw-form" novalidate>
            <div class="field">
              <label for="pw-current">Current password</label>
              <input id="pw-current" name="current_password" type="password" autocomplete="current-password" required>
            </div>
            <div class="field">
              <label for="pw-new">New password</label>
              <input id="pw-new" name="new_password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required>
              <small class="hint">At least 8 characters.</small>
            </div>
            <p class="form-error" id="pw-error" role="alert" hidden></p>
            <button class="btn btn-ghost" type="submit">Update password</button>
          </form>
        </section>

        <section class="card span-all" aria-labelledby="activity-h">
          <h2 class="h3" id="activity-h">Wallet activity</h2>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Type</th><th>Amount</th><th>Reference</th><th>Date</th></tr></thead>
              <tbody>${txnRows}</tbody>
            </table>
          </div>
        </section>
      </div>`);

    bindForm('profile-form', 'profile-error', async (f) => {
      const { user } = await api('/profile', { method: 'PUT', body: f });
      state.user = { ...state.user, ...user };
      UC.renderNav();
      toast('Profile saved.');
    });

    bindForm('pw-form', 'pw-error', async (f, form) => {
      await api('/profile/password', { method: 'PUT', body: f });
      form.reset();
      toast('Password updated.');
    });
  }

  // ---------- Orders ----------

  const orderItemsSummary = (order) => {
    const names = order.items.map((i) => (i.quantity > 1 ? `${i.name} × ${i.quantity}` : i.name));
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more` : names.join(', ');
  };

  async function viewOrders() {
    const { orders } = await api('/orders');
    setView(`
      <div class="page-head">
        <h1 class="h1">My orders</h1>
        <p class="muted">Every purchase, with the status of each item.</p>
      </div>
      ${
        orders.length
          ? `<ul class="order-list">
              ${orders
                .map(
                  (o) => `
                <li>
                  <a class="card order-card" href="#/orders/${Number(o.id)}">
                    <div class="order-card-top">
                      <strong>Order #${Number(o.id)}</strong>
                      <span class="badge badge-${esc(o.status)}">${esc(ORDER_STATUS[o.status] || o.status)}</span>
                    </div>
                    <p class="order-card-items">${esc(orderItemsSummary(o))}</p>
                    <div class="order-card-bottom">
                      <span class="muted small">${esc(dateFmt(o.created_at))}</span>
                      <strong>${esc(money(o.total_cents))}</strong>
                    </div>
                  </a>
                </li>`
                )
                .join('')}
            </ul>`
          : `<div class="card empty-state">
              <p>You have no orders yet.</p>
              <a class="btn btn-primary" href="#/">Browse the shop</a>
            </div>`
      }`);
  }

  async function viewOrder(id) {
    const { order } = await api(`/orders/${id}`);
    const paid = true;
    const finalStatus = order.status;
    const refunded = order.items.filter((i) => i.status === 'refunded');
    const refundTotal = refunded.reduce((s, i) => s + i.unit_price_cents * i.quantity, 0);

    const steps = [
      { label: 'Order placed', done: true, note: dateFmt(order.created_at) },
      { label: 'Payment taken from wallet', done: paid, note: esc(money(order.total_cents)) },
      {
        label:
          finalStatus === 'refunded'
            ? 'Delivery failed'
            : finalStatus === 'partially_refunded'
              ? 'Partly delivered'
              : finalStatus === 'delivered'
                ? 'Delivered to Player ID'
                : 'Delivering',
        done: finalStatus !== 'processing',
        note: refundTotal ? `${esc(money(refundTotal))} refunded to wallet` : '',
        tone: finalStatus === 'refunded' ? 'bad' : finalStatus === 'partially_refunded' ? 'warn' : 'ok',
      },
    ];

    setView(`
      <div class="page-head split">
        <div>
          <a class="link small" href="#/orders">← All orders</a>
          <h1 class="h1">Order #${Number(order.id)}</h1>
          <p class="muted">Placed ${esc(dateFmt(order.created_at))}</p>
        </div>
        <div class="head-actions">
          <span class="badge badge-${esc(finalStatus)} badge-lg">${esc(ORDER_STATUS[finalStatus] || finalStatus)}</span>
          <button type="button" class="btn btn-ghost" data-print>Print receipt</button>
        </div>
      </div>

      <div class="grid-2 order-grid">
        <section class="card" aria-labelledby="items-h">
          <h2 class="h3" id="items-h">Items</h2>
          <ul class="order-items">
            ${order.items
              .map(
                (i) => `
              <li class="order-item">
                <div class="tile tile-sm tile-${esc(i.category)}">${esc((i.name[0] || '?').toUpperCase())}</div>
                <div class="order-item-body">
                  <strong>${esc(i.name)}</strong>
                  <span class="small muted">${i.uc_amount ? `${esc(ucFmt(i.uc_amount * i.quantity))}` : 'Cosmetic'}${i.quantity > 1 ? ` · qty ${i.quantity}` : ''}</span>
                  ${i.delivery_ref ? `<span class="small muted mono">Ref ${esc(i.delivery_ref)}</span>` : ''}
                </div>
                <div class="order-item-end">
                  <span class="badge badge-${esc(i.status)}">${esc(ITEM_STATUS[i.status] || i.status)}</span>
                  <strong>${esc(money(i.unit_price_cents * i.quantity))}</strong>
                </div>
              </li>`
              )
              .join('')}
          </ul>
        </section>

        <section class="card" aria-labelledby="sum-h">
          <h2 class="h3" id="sum-h">Summary</h2>
          <dl class="summary">
            <div><dt>Player ID</dt><dd class="mono">${esc(order.pubg_id)}</dd></div>
            <div><dt>Total paid</dt><dd>${esc(money(order.total_cents))}</dd></div>
            ${refundTotal ? `<div><dt>Refunded</dt><dd class="pos">${esc(money(refundTotal))}</dd></div>` : ''}
          </dl>
          <h3 class="h4">Progress</h3>
          <ol class="timeline">
            ${steps
              .map(
                (s) => `
              <li class="${s.done ? 'is-done' : ''} ${s.tone ? `tone-${s.tone}` : ''}">
                <span class="dot" aria-hidden="true"></span>
                <div>
                  <strong>${esc(s.label)}</strong>
                  ${s.note ? `<span class="small muted">${s.note}</span>` : ''}
                </div>
              </li>`
              )
              .join('')}
          </ol>
        </section>
      </div>`);
  }

  // ---------- Events (accounts) ----------

  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-toggle-pass]');
    if (toggle) {
      const input = $(`#${toggle.dataset.togglePass}`);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      toggle.setAttribute('aria-pressed', String(show));
      return;
    }

    if (e.target.closest('[data-print]')) return window.print();

    const topup = e.target.closest('[data-topup]');
    if (topup) {
      topup.disabled = true;
      api('/wallet/topup', { method: 'POST', body: { amount_cents: Number(topup.dataset.topup) } })
        .then((data) => {
          state.user.balance_cents = data.balance_cents;
          UC.renderNav();
          toast(`Added ${money(topup.dataset.topup)} to your wallet.`);
          return viewProfile();
        })
        .catch((err) => toast(err.message, 'error'))
        .finally(() => (topup.disabled = false));
    }
  });

  UC.viewLogin = viewLogin;
  UC.viewSignup = viewSignup;
  UC.viewProfile = viewProfile;
  UC.viewOrders = viewOrders;
  UC.viewOrder = viewOrder;
})();
