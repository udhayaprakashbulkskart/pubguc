'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, uniqueEmail } = require('./helpers');

let env;
before(async () => {
  env = await start();
});
after(async () => {
  await env.stop();
});

test('signup validates input and rejects duplicate emails', async () => {
  const call = client(env.base);
  const email = uniqueEmail('dup');

  assert.equal((await call('POST', '/api/auth/signup', { name: 'A', email, password: 'longenough' })).status, 400);
  assert.equal((await call('POST', '/api/auth/signup', { name: 'Ann', email: 'bad', password: 'longenough' })).status, 400);
  assert.equal((await call('POST', '/api/auth/signup', { name: 'Ann', email, password: 'short' })).status, 400);
  assert.equal(
    (await call('POST', '/api/auth/signup', { name: 'Ann', email, password: 'longenough', pubg_id: 'abc' })).status,
    400
  );

  const ok = await call('POST', '/api/auth/signup', { name: 'Ann', email, password: 'longenough' });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.email, email);
  assert.equal(ok.data.user.balance_cents, 0);
  assert.equal(ok.data.user.password_hash, undefined, 'password hash must never be returned');

  const dup = await call('POST', '/api/auth/signup', { name: 'Ann', email: email.toUpperCase(), password: 'longenough' });
  assert.equal(dup.status, 409);
});

test('login, session and logout work', async () => {
  const email = uniqueEmail('login');
  const call = client(env.base);
  await call('POST', '/api/auth/signup', { name: 'Login User', email, password: 'correct-horse' });

  assert.equal((await client(env.base)('GET', '/api/auth/me')).data.user, null, 'a client without a cookie is anonymous');
  assert.equal((await call('POST', '/api/auth/login', { email, password: 'wrong-password' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email, password: 'correct-horse' })).status, 200);
  assert.equal((await call('GET', '/api/auth/me')).data.user.name, 'Login User');

  await call('POST', '/api/auth/logout');
  assert.equal((await call('GET', '/api/auth/me')).data.user, null, 'cookie is cleared after logout');
});

test('protected endpoints require a session', async () => {
  const call = client(env.base);
  assert.equal((await call('GET', '/api/orders')).status, 401);
  assert.equal((await call('GET', '/api/wallet')).status, 401);
  assert.equal((await call('POST', '/api/checkout', { items: [{ product_id: 1 }] })).status, 401);
  assert.equal((await call('PUT', '/api/profile', { name: 'X' })).status, 401);
});

test('profile can be updated and the password changed', async () => {
  const email = uniqueEmail('profile');
  const call = client(env.base);
  await call('POST', '/api/auth/signup', { name: 'Old Name', email, password: 'first-password' });

  const upd = await call('PUT', '/api/profile', { name: 'New Name', phone: '+1 555 0100', pubg_id: '5123456789' });
  assert.equal(upd.status, 200);
  assert.equal(upd.data.user.name, 'New Name');
  assert.equal(upd.data.user.pubg_id, '5123456789');

  assert.equal((await call('PUT', '/api/profile/password', { current_password: 'nope', new_password: 'second-password' })).status, 400);
  assert.equal((await call('PUT', '/api/profile/password', { current_password: 'first-password', new_password: 'second-password' })).status, 200);

  await call('POST', '/api/auth/logout');
  assert.equal((await call('POST', '/api/auth/login', { email, password: 'first-password' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email, password: 'second-password' })).status, 200);
});

test('malformed JSON, unknown API routes and security headers', async () => {
  assert.equal((await client(env.base)('GET', '/api/does-not-exist')).status, 404);

  const bad = await fetch(`${env.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad json',
  });
  assert.equal(bad.status, 400);

  const res = await fetch(`${env.base}/api/config`);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
});
