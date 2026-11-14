'use strict';

const { tx } = require('./db');
const { seedCatalog } = require('../seed');

// Idempotent DDL. Safe to run on every cold start.
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
     id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     name          TEXT        NOT NULL,
     email         TEXT        NOT NULL UNIQUE,
     password_hash TEXT        NOT NULL,
     phone         TEXT        NOT NULL DEFAULT '',
     pubg_id       TEXT        NOT NULL DEFAULT '',
     balance_cents INTEGER     NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS categories (
     slug        TEXT PRIMARY KEY,
     name        TEXT    NOT NULL,
     description TEXT    NOT NULL DEFAULT '',
     fulfilment  TEXT    NOT NULL CHECK (fulfilment IN ('uc', 'cosmetic')),
     sort_order  INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS products (
     id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     category    TEXT    NOT NULL REFERENCES categories(slug),
     name        TEXT    NOT NULL,
     description TEXT    NOT NULL DEFAULT '',
     rarity      TEXT    NOT NULL DEFAULT 'common' CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
     price_cents INTEGER NOT NULL CHECK (price_cents > 0),
     uc_amount   INTEGER,
     popular     BOOLEAN NOT NULL DEFAULT false,
     active      BOOLEAN NOT NULL DEFAULT true,
     sort_order  INTEGER NOT NULL DEFAULT 0,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS orders (
     id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     user_id      INTEGER     NOT NULL REFERENCES users(id),
     pubg_id      TEXT        NOT NULL,
     total_cents  INTEGER     NOT NULL,
     status       TEXT        NOT NULL CHECK (status IN ('processing', 'delivered', 'partially_refunded', 'refunded')),
     client_ref   TEXT,
     created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS order_items (
     id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
     product_id       INTEGER REFERENCES products(id),
     name             TEXT    NOT NULL,
     category         TEXT    NOT NULL,
     rarity           TEXT    NOT NULL,
     uc_amount        INTEGER,
     quantity         INTEGER NOT NULL CHECK (quantity > 0),
     unit_price_cents INTEGER NOT NULL,
     status           TEXT    NOT NULL CHECK (status IN ('processing', 'delivered', 'refunded')),
     delivery_ref     TEXT    NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS wallet_txns (
     id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     user_id      INTEGER     NOT NULL REFERENCES users(id),
     type         TEXT        NOT NULL CHECK (type IN ('topup', 'purchase', 'refund')),
     amount_cents INTEGER     NOT NULL,
     ref          TEXT        NOT NULL DEFAULT '',
     created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_products_category ON products (category, active, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_txns (user_id, id DESC)`,
  // Postgres allows several NULL client_refs per user, so this only constrains real keys.
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_client_ref ON orders (user_id, client_ref)`,
];

let ready = null;

/**
 * Creates the schema and seeds the catalog once per process.
 * An advisory lock serialises concurrent cold starts.
 */
function ensureReady() {
  if (!ready) {
    ready = tx(async (t) => {
      await t.query('SELECT pg_advisory_xact_lock(7001)');
      for (const sql of STATEMENTS) await t.query(sql);
      await seedCatalog(t);
    }).catch((err) => {
      ready = null; // allow a retry on the next request
      throw err;
    });
  }
  return ready;
}

module.exports = { ensureReady };
