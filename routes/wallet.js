'use strict';

const express = require('express');
const { query, tx } = require('../lib/db');
const { HttpError, wrap } = require('../lib/util');
const { requireAuth, getUserById } = require('../lib/auth');
const { PAYMENT_MODE } = require('../lib/config');

const router = express.Router();
const MIN_TOPUP = 100; // Rs 1.00 in paise
const MAX_TOPUP = 10000000; // Rs 1,00,000.00 in paise

router.get(
  '/wallet',
  requireAuth,
  wrap(async (req, res) => {
    const user = await getUserById(req.user.id);
    const transactions = await query(
      'SELECT id, type, amount_cents, ref, created_at FROM wallet_txns WHERE user_id = $1 ORDER BY id DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ balance_cents: user.balance_cents, transactions, paymentMode: PAYMENT_MODE });
  })
);

router.post(
  '/wallet/topup',
  requireAuth,
  wrap(async (req, res) => {
    if (PAYMENT_MODE !== 'demo') throw new HttpError(501, 'Online payments are not configured yet.');

    const amount = Number(req.body.amount_cents);
    if (!Number.isInteger(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) {
      throw new HttpError(400, 'Top-up must be between Rs 1 and Rs 1,00,000.');
    }

    await tx(async (t) => {
      await t.query('UPDATE users SET balance_cents = balance_cents + $1 WHERE id = $2', [amount, req.user.id]);
      await t.query("INSERT INTO wallet_txns (user_id, type, amount_cents, ref) VALUES ($1, 'topup', $2, 'demo')", [
        req.user.id,
        amount,
      ]);
    });

    res.json({ balance_cents: (await getUserById(req.user.id)).balance_cents });
  })
);

module.exports = router;
