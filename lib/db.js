'use strict';

/*
 * Data access. One API, two drivers:
 *   - DATABASE_URL set  -> Postgres via `pg` (Neon in production)
 *   - otherwise         -> embedded Postgres via PGlite (local development and tests)
 *
 * Routes only use query(), one() and tx(). Placeholders are $1, $2, ...
 */
const path = require('path');

const DEFAULT_PGLITE_DIR = path.join(__dirname, '..', 'data', 'pgdata');
let driver = null;

function createDriver() {
  const url = process.env.DATABASE_URL;

  if (url) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX) || 3,
      idleTimeoutMillis: 10000,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true },
    });
    pool.on('error', (err) => console.error('[db] idle client error:', err.message));

    return {
      kind: 'pg',
      query: async (sql, params = []) => (await pool.query(sql, params)).rows,
      tx: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: async (sql, params = []) => (await client.query(sql, params)).rows });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite(process.env.PGLITE_DIR || DEFAULT_PGLITE_DIR);
  return {
    kind: 'pglite',
    query: async (sql, params = []) => (await pg.query(sql, params)).rows,
    tx: (fn) => pg.transaction((t) => fn({ query: async (sql, params = []) => (await t.query(sql, params)).rows })),
    close: () => pg.close(),
  };
}

function db() {
  if (!driver) driver = createDriver();
  return driver;
}

const query = (sql, params) => db().query(sql, params);
const one = async (sql, params) => (await query(sql, params))[0] || null;
const tx = (fn) => db().tx(fn);
const close = () => (driver ? driver.close() : Promise.resolve());
const driverName = () => db().kind;

module.exports = { query, one, tx, close, driverName };
