'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { ensureReady } = require('./lib/schema');
const { PORT, PAYMENT_MODE, IS_PROD, publicConfig } = require('./lib/config');
const { HttpError } = require('./lib/util');
const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const shopRoutes = require('./routes/shop');

const app = express();
if (IS_PROD) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
      "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  next();
});

app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

// Create the schema and seed the catalog once per process before any API call (idempotent).
app.use('/api', async (req, res, next) => {
  try {
    await ensureReady();
    next();
  } catch (err) {
    next(err);
  }
});

app.get('/api/config', (req, res) => res.json(publicConfig()));
app.use('/api', authRoutes);
app.use('/api', walletRoutes);
app.use('/api', shopRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: IS_PROD ? '1h' : 0 }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`${publicConfig().brand} running at http://localhost:${PORT} (payments: ${PAYMENT_MODE})`);
  });
}

module.exports = app;
