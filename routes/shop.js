'use strict';

const express = require('express');
const { query, one, tx } = require('../lib/db');
const { HttpError, wrap, str, PUBG_ID_RE } = require('../lib/util');
const { requireAuth, getUserById } = require('../lib/auth');
const { fulfil } = require('../delivery');

const router = express.Router();

const MAX_LINES = 10;
const MAX_QTY = 10;
const UNIQUE_VIOLATION = '23505';
const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const SORTS = {
  featured: 'c.sort_order ASC, p.sort_order ASC, p.id ASC',
  popular: 'p.popular DESC, c.sort_order ASC, p.sort_order ASC, p.id ASC',
  price_asc: 'p.price_cents ASC, p.id ASC',
  price_desc: 'p.price_cents DESC, p.id ASC',
  newest: 'p.id DESC',
};

const ORDER_COLS = 'id, pubg_id, total_cents, status, created_at';
const ITEM_COLS = 'id, product_id, name, category, rarity, uc_amount, quantity, unit_price_cents, status, delivery_ref';

// Order with its line items, only if it belongs to userId.
async function loadOrder(id, userId) {
  const order = await one(`SELECT ${ORDER_COLS} FROM orders WHERE id = $1 AND user_id = $2`, [id, userId]);
  if (!order) return null;
  order.items = await query(`SELECT ${ITEM_COLS} FROM order_items WHERE order_id = $1 ORDER BY id`, [id]);
  return order;
}

function parseCart(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) throw new HttpError(400, 'Your cart is empty.');
  if (items.length > MAX_LINES) throw new HttpError(400, `You can add up to ${MAX_LINES} items per order.`);

  // Duplicate lines are merged, then the merged quantity is validated.
  const lines = new Map();
  for (const raw of items) {
    const productId = Number(raw && raw.product_id);
    const quantity = raw && raw.quantity !== undefined ? Number(raw.quantity) : 1;
    if (!Number.isInteger(productId) || productId <= 0) throw new HttpError(400, 'Invalid cart item.');
    if (!Number.isInteger(quantity) || quantity < 1) throw new HttpError(400, 'Quantity must be at least 1.');
    const merged = (lines.get(productId) || 0) + quantity;
    if (merged > MAX_QTY) throw new HttpError(400, `You can buy up to ${MAX_QTY} of one item per order.`);
    lines.set(productId, merged);
  }

  const clientRef = str(body.client_ref, 64);
  if (clientRef && !/^[\w-]{8,64}$/.test(clientRef)) throw new HttpError(400, 'Invalid checkout reference.');

  return { pubgId: str(body.pubg_id, 15), lines, clientRef };
}

// ---------- Catalog ----------

router.get(
  '/catalog',
  wrap(async (req, res) => {
    const categories = await query('SELECT slug, name, description, fulfilment FROM categories ORDER BY sort_order');

    const where = ['p.active'];
    const params = [];

    const category = str(req.query.category, 30);
    if (category) {
      params.push(category);
      where.push(`p.category = $${params.length}`);
    }

    const q = str(req.query.q, 60);
    if (q) {
      // Escape LIKE wildcards so user input is matched literally.
      params.push(`%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
      where.push(`p.name ILIKE $${params.length}`);
    }

    const rarity = str(req.query.rarity, 20);
    if (RARITIES.includes(rarity)) {
      params.push(rarity);
      where.push(`p.rarity = $${params.length}`);
    }

    const sort = SORTS[str(req.query.sort, 20)] || SORTS.featured;

    const products = (
      await query(
        `SELECT p.id, p.category, p.name, p.description, p.rarity, p.price_cents, p.uc_amount, p.popular
         FROM products p JOIN categories c ON c.slug = p.category
         WHERE ${where.join(' AND ')}
         ORDER BY ${sort}`,
        params
      )
    ).map((p) => ({ ...p, popular: !!p.popular }));

    res.json({ categories, products });
  })
);

// ---------- Checkout ----------

router.post(
  '/checkout',
  requireAuth,
  wrap(async (req, res) => {
    const { pubgId, lines, clientRef } = parseCart(req.body);
    const playerId = pubgId || req.user.pubg_id;
    if (!PUBG_ID_RE.test(playerId)) throw new HttpError(400, 'Enter a valid 6–15 digit PUBG Player ID.');

    // Idempotency: a repeated submit of the same checkout returns the original order, never a second charge.
    const existingResponse = async () => {
      if (!clientRef) return null;
      const existing = await one('SELECT id FROM orders WHERE user_id = $1 AND client_ref = $2', [req.user.id, clientRef]);
      if (!existing) return null;
      return {
        order: await loadOrder(existing.id, req.user.id),
        balance_cents: (await getUserById(req.user.id)).balance_cents,
        duplicate: true,
      };
    };

    const earlier = await existingResponse();
    if (earlier) return res.json(earlier);

    // Step 1: re-price from the database, lock the wallet row, check funds, and take payment in one transaction.
    let orderId;
    try {
      orderId = await tx(async (t) => {
        const [wallet] = await t.query('SELECT balance_cents FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);

        const items = [];
        for (const [productId, quantity] of lines) {
          const [p] = await t.query(
            `SELECT p.*, c.fulfilment FROM products p JOIN categories c ON c.slug = p.category
             WHERE p.id = $1 AND p.active`,
            [productId]
          );
          if (!p) throw new HttpError(404, 'An item in your cart is no longer available. Please review your cart.');
          if (p.fulfilment === 'cosmetic' && quantity > 1) {
            throw new HttpError(400, `${p.name} can only be bought once per Player ID.`);
          }
          items.push({ ...p, quantity });
        }

        const total = items.reduce((sum, i) => sum + i.price_cents * i.quantity, 0);
        if (wallet.balance_cents < total) throw new HttpError(402, 'Not enough wallet balance. Add funds to continue.');

        const [order] = await t.query(
          "INSERT INTO orders (user_id, pubg_id, total_cents, status, client_ref) VALUES ($1, $2, $3, 'processing', $4) RETURNING id",
          [req.user.id, playerId, total, clientRef || null]
        );

        for (const i of items) {
          await t.query(
            `INSERT INTO order_items (order_id, product_id, name, category, rarity, uc_amount, quantity, unit_price_cents, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing')`,
            [order.id, i.id, i.name, i.category, i.rarity, i.uc_amount, i.quantity, i.price_cents]
          );
        }

        await t.query('UPDATE users SET balance_cents = balance_cents - $1 WHERE id = $2', [total, req.user.id]);
        await t.query("INSERT INTO wallet_txns (user_id, type, amount_cents, ref) VALUES ($1, 'purchase', $2, $3)", [
          req.user.id,
          -total,
          `order:${order.id}`,
        ]);
        return order.id;
      });
    } catch (err) {
      // Two identical submits raced: the loser hits the unique key and gets the winner's order.
      if (err.code === UNIQUE_VIOLATION && clientRef) {
        const dup = await existingResponse();
        if (dup) return res.json(dup);
      }
      throw err;
    }

    // Step 2: fulfil every line in parallel. Each line succeeds or fails on its own.
    const rows = await query(
      `SELECT oi.*, c.fulfilment FROM order_items oi JOIN categories c ON c.slug = oi.category
       WHERE oi.order_id = $1 ORDER BY oi.id`,
      [orderId]
    );
    const results = await Promise.allSettled(
      rows.map((r) => fulfil({ fulfilment: r.fulfilment, orderItemId: r.id, pubgId: playerId }))
    );

    // Step 3: record each line's outcome, refund only the failed lines, and set the order status.
    await tx(async (t) => {
      let failed = 0;
      let refundCents = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const r = results[i];
        if (r.status === 'fulfilled' && r.value && r.value.ok) {
          await t.query("UPDATE order_items SET status = 'delivered', delivery_ref = $1 WHERE id = $2", [
            String(r.value.ref || ''),
            row.id,
          ]);
        } else {
          failed += 1;
          refundCents += row.unit_price_cents * row.quantity;
          await t.query("UPDATE order_items SET status = 'refunded' WHERE id = $1", [row.id]);
          const reason = (r.reason && r.reason.message) || 'delivery not confirmed';
          console.error(`[delivery] order ${orderId} line ${row.id} refunded: ${reason}`);
        }
      }

      if (refundCents > 0) {
        await t.query('UPDATE users SET balance_cents = balance_cents + $1 WHERE id = $2', [refundCents, req.user.id]);
        await t.query("INSERT INTO wallet_txns (user_id, type, amount_cents, ref) VALUES ($1, 'refund', $2, $3)", [
          req.user.id,
          refundCents,
          `order:${orderId}`,
        ]);
      }

      const status = failed === 0 ? 'delivered' : failed === rows.length ? 'refunded' : 'partially_refunded';
      await t.query('UPDATE orders SET status = $1 WHERE id = $2', [status, orderId]);
    });

    res.status(201).json({
      order: await loadOrder(orderId, req.user.id),
      balance_cents: (await getUserById(req.user.id)).balance_cents,
    });
  })
);

// ---------- Orders ----------

router.get(
  '/orders',
  requireAuth,
  wrap(async (req, res) => {
    const orders = await query(
      `SELECT ${ORDER_COLS} FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 100`,
      [req.user.id]
    );
    if (orders.length === 0) return res.json({ orders: [] });

    // One query for all line items, grouped in memory.
    const items = await query(
      `SELECT order_id, ${ITEM_COLS} FROM order_items WHERE order_id = ANY($1::int[]) ORDER BY id`,
      [orders.map((o) => o.id)]
    );
    const byOrder = new Map(orders.map((o) => [o.id, []]));
    for (const { order_id, ...item } of items) byOrder.get(order_id).push(item);
    for (const o of orders) o.items = byOrder.get(o.id);

    res.json({ orders });
  })
);

router.get(
  '/orders/:id',
  requireAuth,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const order = Number.isInteger(id) ? await loadOrder(id, req.user.id) : null;
    if (!order) throw new HttpError(404, 'Order not found.');
    res.json({ order });
  })
);

module.exports = router;
