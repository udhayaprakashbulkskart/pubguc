'use strict';

const crypto = require('crypto');

const IS_PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

// 'demo' credits wallet top-ups instantly (dev/test only).
// 'gateway' is a real payment provider, not wired yet, so top-ups return 501.
const PAYMENT_MODE = process.env.PAYMENT_MODE || (IS_PROD ? 'gateway' : 'demo');

// Delivery modes that must never run in production.
const DEV_ONLY_DELIVERY = ['simulate', 'fail', 'fail-cosmetic'];

if (IS_PROD && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set when NODE_ENV=production (use your Neon connection string)');
}
if (IS_PROD && PAYMENT_MODE === 'demo') {
  throw new Error('PAYMENT_MODE=demo is not allowed when NODE_ENV=production');
}
if (IS_PROD && DEV_ONLY_DELIVERY.includes(process.env.DELIVERY_MODE)) {
  throw new Error(`DELIVERY_MODE=${process.env.DELIVERY_MODE} is not allowed when NODE_ENV=production`);
}

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (IS_PROD) throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[warn] JWT_SECRET not set: using a random dev secret (sessions reset on restart).');
}

const BRAND = process.env.BRAND_NAME || 'UC Topup';
const CURRENCY = (process.env.CURRENCY || 'USD').toUpperCase();

// Safe subset that the browser is allowed to see.
function publicConfig() {
  return { brand: BRAND, currency: CURRENCY, paymentMode: PAYMENT_MODE };
}

module.exports = { IS_PROD, PORT, PAYMENT_MODE, JWT_SECRET, publicConfig };
