'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, uniqueEmail } = require('./helpers');

let env;
let query;
let one;

before(async () => {
  env = await start();
  ({ query, one } = require('../lib/db'));
});
after(async () => {
  await env.stop();
});

const product = (name) => one('SELECT * FROM products WHERE name = $1', [name]);

async function newBuyer(tag, { balance = 0, pubgId = '5000011122' } = {}) {
  const call = client(env.base);
  const { data } = await call('POST', '/api/auth/signup', {
    name: `${tag} Buyer`,
    email: uniqueEmail(tag),
    password: 'buyer-password-1',
    pubg_id: pubgId,
  });
  const user = data.user;
  if (balance > 0) await query('UPDATE users SET balance_cents = $1 WHERE id = $2', [balance, user.id]);
  return { call, user };
}

const balanceOf = async (userId) => (await one('SELECT balance_cents FROM users WHERE id = $1', [userId])).balance_cents;
const countOrders = async () => (await one('SELECT COUNT(*)::int AS n FROM orders')).n;

// ---------- Catalog ----------

test('catalog lists categories and active products with sensible defaults', async () => {
  const { data } = await client(env.base)('GET', '/api/catalog');
  assert.deepEqual(
    data.categories.map((c) => c.slug),
    ['uc', 'suits', 'car-skins']
  );
  assert.ok(data.products.length >= 14);
  assert.ok(data.products.every((p) => typeof p.popular === 'boolean'));
  assert.equal(data.products.find((p) => p.name === '660 UC').popular, true);
});

test('catalog filters by category, rarity and search text', async () => {
  const call = client(env.base);

  const suits = await call('GET', '/api/catalog?category=suits');
  assert.ok(suits.data.products.length > 0);
  assert.ok(suits.data.products.every((p) => p.category === 'suits'));

  const epic = await call('GET', '/api/catalog?rarity=epic');
  assert.ok(epic.data.products.every((p) => p.rarity === 'epic'));

  const search = await call('GET', '/api/catalog?q=skin');
  assert.ok(search.data.products.length > 0);
  assert.ok(search.data.products.every((p) => /skin/i.test(p.name)), 'search is case-insensitive');

  // LIKE wildcards in user input must be treated as plain text.
  assert.equal((await call('GET', '/api/catalog?q=%25')).data.products.length, 0);
  assert.equal((await call('GET', '/api/catalog?q=_')).data.products.length, 0);

  // Unknown rarity is ignored, not an error.
  assert.ok((await call('GET', '/api/catalog?rarity=mythic')).data.products.length > 0);
});

test('catalog sorting orders prices correctly', async () => {
  const call = client(env.base);
  const asc = (await call('GET', '/api/catalog?sort=price_asc')).data.products.map((p) => p.price_cents);
  const desc = (await call('GET', '/api/catalog?sort=price_desc')).data.products.map((p) => p.price_cents);
  assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
  assert.deepEqual(desc, [...desc].sort((a, b) => b - a));
});

// ---------- Wallet ----------

test('wallet top-up validates the amount and credits the balance', async () => {
  const { call } = await newBuyer('wallet');
  assert.equal((await call('POST', '/api/wallet/topup', { amount_cents: 50 })).status, 400);
  assert.equal((await call('POST', '/api/wallet/topup', { amount_cents: 20000000 })).status, 400);

  const top = await call('POST', '/api/wallet/topup', { amount_cents: 2500 });
  assert.equal(top.status, 200);
  assert.equal(top.data.balance_cents, 2500);

  const wallet = await call('GET', '/api/wallet');
  assert.equal(wallet.data.transactions[0].type, 'topup');
});

// ---------- Checkout validation ----------

test('checkout rejects empty carts, bad lines and oversized orders', async () => {
  const { call } = await newBuyer('validation', { balance: 100000000 });
  const uc = await product('660 UC');

  assert.equal((await call('POST', '/api/checkout', { items: [] })).status, 400);
  assert.equal((await call('POST', '/api/checkout', {})).status, 400);
  assert.equal((await call('POST', '/api/checkout', { items: [{ product_id: 'abc' }] })).status, 400);
  assert.equal((await call('POST', '/api/checkout', { items: [{ product_id: uc.id, quantity: 0 }] })).status, 400);
  assert.equal((await call('POST', '/api/checkout', { items: [{ product_id: uc.id, quantity: 11 }] })).status, 400);
  assert.equal(
    (await call('POST', '/api/checkout', { items: [{ product_id: uc.id, quantity: 6 }, { product_id: uc.id, quantity: 6 }] })).status,
    400,
    'duplicate lines count toward the limit'
  );

  const tooMany = Array.from({ length: 11 }, () => ({ product_id: uc.id }));
  assert.equal((await call('POST', '/api/checkout', { items: tooMany })).status, 400);

  assert.equal((await call('POST', '/api/checkout', { items: [{ product_id: uc.id }], pubg_id: '12' })).status, 400);
  assert.equal((await call('POST', '/api/checkout', { items: [{ product_id: uc.id }], client_ref: 'x' })).status, 400);
  assert.equal((await call('POST', '/api/checkout', { items: [{ product_id: 999999 }] })).status, 404);
});

test('checkout refuses when the wallet is short and creates nothing', async () => {
  const { call, user } = await newBuyer('broke');
  const before = await countOrders();

  const res = await call('POST', '/api/checkout', { items: [{ product_id: (await product('660 UC')).id }] });
  assert.equal(res.status, 402);
  assert.equal(await countOrders(), before);
  assert.equal(await balanceOf(user.id), 0);
});

test('inactive products cannot be bought', async () => {
  const { call } = await newBuyer('inactive', { balance: 100000000 });
  const p = await product('Rust Runner Skin');
  await query('UPDATE products SET active = false WHERE id = $1', [p.id]);
  try {
    const res = await call('POST', '/api/checkout', { items: [{ product_id: p.id }] });
    assert.equal(res.status, 404);
    const listed = (await call('GET', '/api/catalog?category=car-skins')).data.products;
    assert.equal(listed.some((x) => x.id === p.id), false);
  } finally {
    await query('UPDATE products SET active = true WHERE id = $1', [p.id]);
  }
});

test('cosmetics can only be bought once per order', async () => {
  const { call } = await newBuyer('once', { balance: 100000000 });
  const suit = await product('Frostline Suit');
  const res = await call('POST', '/api/checkout', { items: [{ product_id: suit.id, quantity: 2 }] });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /once per Player ID/);
});

// ---------- Checkout success and pricing ----------

test('multi-item checkout charges server prices and delivers every line', async () => {
  const { call, user } = await newBuyer('multi', { balance: 100000000 });
  const uc = await product('660 UC');
  const suit = await product('Desert Ranger Suit');
  const skin = await product('Neon Drift Skin');

  // The client tries to set its own price. The server must ignore it.
  const res = await call('POST', '/api/checkout', {
    items: [
      { product_id: uc.id, quantity: 2, price_cents: 1 },
      { product_id: suit.id },
      { product_id: skin.id },
    ],
    client_ref: 'multi-checkout-001',
  });

  const expected = uc.price_cents * 2 + suit.price_cents + skin.price_cents;
  assert.equal(res.status, 201);
  assert.equal(res.data.order.status, 'delivered');
  assert.equal(res.data.order.total_cents, expected);
  assert.equal(res.data.order.items.length, 3);
  assert.ok(res.data.order.items.every((i) => i.status === 'delivered' && i.delivery_ref));
  assert.equal(res.data.balance_cents, 100000000 - expected);
  assert.equal(await balanceOf(user.id), 100000000 - expected);

  const txn = await one(
    "SELECT amount_cents FROM wallet_txns WHERE user_id = $1 AND type = 'purchase' ORDER BY id DESC LIMIT 1",
    [user.id]
  );
  assert.equal(txn.amount_cents, -expected);
});

test('checkout uses the saved Player ID when none is sent', async () => {
  const { call } = await newBuyer('saved', { balance: 100000000, pubgId: '7000011122' });
  const res = await call('POST', '/api/checkout', { items: [{ product_id: (await product('60 UC')).id }] });
  assert.equal(res.status, 201);
  assert.equal(res.data.order.pubg_id, '7000011122');
});

test('a repeated checkout with the same client_ref is charged only once', async () => {
  const { call, user } = await newBuyer('idem', { balance: 100000000 });
  const pkg = await product('325 UC');
  const body = { items: [{ product_id: pkg.id }], client_ref: 'idem-key-0001' };

  const first = await call('POST', '/api/checkout', body);
  const second = await call('POST', '/api/checkout', body);

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.data.duplicate, true);
  assert.equal(second.data.order.id, first.data.order.id);
  assert.equal(await balanceOf(user.id), 100000000 - pkg.price_cents);
});

test('concurrent identical checkouts create one order and one charge', async () => {
  const { call, user } = await newBuyer('race', { balance: 100000000 });
  const pkg = await product('60 UC');
  const body = { items: [{ product_id: pkg.id }], client_ref: 'race-key-0001' };

  const results = await Promise.all([call('POST', '/api/checkout', body), call('POST', '/api/checkout', body), call('POST', '/api/checkout', body)]);

  const ids = new Set(results.filter((r) => r.status < 300).map((r) => r.data.order.id));
  assert.equal(ids.size, 1, 'every successful response refers to the same order');
  assert.equal(await balanceOf(user.id), 100000000 - pkg.price_cents, 'only one charge');
  const orders = await one('SELECT COUNT(*)::int AS n FROM orders WHERE user_id = $1', [user.id]);
  assert.equal(orders.n, 1);
});

test('concurrent purchases cannot overdraw the wallet', async () => {
  const { call, user } = await newBuyer('overdraw', { balance: 3000000 });
  const pkg = await product('660 UC'); // Rs 25,000 each against Rs 30,000 funds: only one can succeed

  const results = await Promise.all([
    call('POST', '/api/checkout', { items: [{ product_id: pkg.id }], client_ref: 'overdraw-a-01' }),
    call('POST', '/api/checkout', { items: [{ product_id: pkg.id }], client_ref: 'overdraw-b-01' }),
  ]);

  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 402).length, 1);
  assert.equal(await balanceOf(user.id), 3000000 - pkg.price_cents);
});

// ---------- Failures and refunds ----------

test('when every line fails, the whole order is refunded', async () => {
  const { call, user } = await newBuyer('allfail', { balance: 100000000 });
  process.env.DELIVERY_MODE = 'fail';
  try {
    const res = await call('POST', '/api/checkout', {
      items: [{ product_id: (await product('660 UC')).id }, { product_id: (await product('Jungle Camo Suit')).id }],
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.order.status, 'refunded');
    assert.ok(res.data.order.items.every((i) => i.status === 'refunded'));
    assert.equal(res.data.balance_cents, 100000000, 'wallet is fully restored');
    assert.equal(await balanceOf(user.id), 100000000);
  } finally {
    process.env.DELIVERY_MODE = 'simulate';
  }
});

test('when only cosmetics fail, UC is kept and only the cosmetic lines are refunded', async () => {
  const { call, user } = await newBuyer('partial', { balance: 100000000 });
  const uc = await product('325 UC');
  const suit = await product('Obsidian Elite Suit');
  const skin = await product('Chrome Storm Skin');

  process.env.DELIVERY_MODE = 'fail-cosmetic';
  try {
    const res = await call('POST', '/api/checkout', {
      items: [{ product_id: uc.id, quantity: 2 }, { product_id: suit.id }, { product_id: skin.id }],
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.order.status, 'partially_refunded');

    const byName = Object.fromEntries(res.data.order.items.map((i) => [i.name, i.status]));
    assert.equal(byName['325 UC'], 'delivered');
    assert.equal(byName['Obsidian Elite Suit'], 'refunded');
    assert.equal(byName['Chrome Storm Skin'], 'refunded');

    const kept = uc.price_cents * 2;
    const refunded = suit.price_cents + skin.price_cents;
    assert.equal(res.data.balance_cents, 100000000 - kept);
    assert.equal(await balanceOf(user.id), 100000000 - kept);

    const refundTxn = await one(
      "SELECT amount_cents FROM wallet_txns WHERE user_id = $1 AND type = 'refund' ORDER BY id DESC LIMIT 1",
      [user.id]
    );
    assert.equal(refundTxn.amount_cents, refunded);
  } finally {
    process.env.DELIVERY_MODE = 'simulate';
  }
});

// ---------- Orders ----------

test('order history and details are private to their owner', async () => {
  const owner = await newBuyer('owner', { balance: 100000000 });
  const stranger = await newBuyer('stranger');

  const placed = await owner.call('POST', '/api/checkout', { items: [{ product_id: (await product('60 UC')).id }] });
  const orderId = placed.data.order.id;

  const list = await owner.call('GET', '/api/orders');
  assert.ok(list.data.orders.some((o) => o.id === orderId));
  assert.ok(list.data.orders.find((o) => o.id === orderId).items.length === 1, 'list includes line items');

  const detail = await owner.call('GET', `/api/orders/${orderId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.order.items[0].name, '60 UC');
  assert.equal(detail.data.order.client_ref, undefined, 'internal fields are not exposed');

  assert.equal((await stranger.call('GET', `/api/orders/${orderId}`)).status, 404);
  assert.equal((await stranger.call('GET', '/api/orders')).data.orders.length, 0);
  assert.equal((await owner.call('GET', '/api/orders/not-a-number')).status, 404);
});
