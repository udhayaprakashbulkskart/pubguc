'use strict';

// Shared test harness. Each test file runs in its own process with its own temporary embedded Postgres.
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-topup-test-'));
process.env.PGLITE_DIR = path.join(tmpDir, 'pgdata');
delete process.env.DATABASE_URL;
process.env.DELIVERY_MODE = 'simulate';
process.env.JWT_SECRET = 'test-secret';
delete process.env.NODE_ENV;
delete process.env.PAYMENT_MODE;

async function start() {
  const app = require('../server');
  const { close } = require('../lib/db');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    await close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { app, base, stop };
}

/** Fetch wrapper that keeps the session cookie between calls, like a browser would. */
function client(base) {
  let cookie = '';
  return async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, headers: res.headers };
  };
}

let counter = 0;
const uniqueEmail = (tag) => `${tag}.${Date.now()}.${++counter}@example.com`;

module.exports = { start, client, uniqueEmail };
