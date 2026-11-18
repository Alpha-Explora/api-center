// Idempotency and per-recipient send limits shared by every instance of a runtime, kept in that
// runtime's own Postgres schema. Runtime roles may select, insert and update but never delete,
// so a released claim is marked 'released' and an expired one is overwritten by the next claim.
const { Pool } = require('pg');
const { createHash } = require('node:crypto');
const { createMemoryIdempotencyStore } = require('./idempotencyStore');
const { createMemoryRateLimitStore } = require('./rateLimitStore');

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCHEMA = /^shared_[a-z]+$/;
const pools = new Map();

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function fingerprint(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)) ?? 'null')
    .digest('hex');
}

/** One pool per database URL, shared by both stores of a process. */
function poolFor(databaseUrl) {
  let pool = pools.get(databaseUrl);
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      allowExitOnIdle: true,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', () => undefined);
    pools.set(databaseUrl, pool);
  }
  return pool;
}

/** The Postgres pool for these options, or null for the memory fallback outside production. */
function resolvePool({ databaseUrl, schema }) {
  if (!SCHEMA.test(schema ?? '')) throw new Error(`Invalid shared runtime schema: ${schema}`);
  if (databaseUrl) return poolFor(databaseUrl);
  if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required for shared service state');
  return null;
}

async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Create an idempotency store in `<schema>.idempotency_keys`; memory outside production without a database. */
function createSharedIdempotencyStore(options) {
  const pool = resolvePool(options);
  if (!pool) return createMemoryIdempotencyStore();
  const table = `${options.schema}.idempotency_keys`;

  return {
    async claim(key, body, { leaseMs = DEFAULT_LEASE_MS } = {}) {
      const print = fingerprint(body);
      const now = new Date();
      const leaseUntil = new Date(now.getTime() + Math.max(1, Number(leaseMs) || DEFAULT_LEASE_MS));
      return inTransaction(pool, async (client) => {
        const claimed = await client.query(
          `INSERT INTO ${table} AS k (key, fingerprint, state, lease_until, updated_at)
           VALUES ($1, $2, 'processing', $3, $4)
           ON CONFLICT (key) DO UPDATE
             SET fingerprint = EXCLUDED.fingerprint, state = 'processing', response = NULL,
                 lease_until = EXCLUDED.lease_until, unknown_since = NULL, expires_at = NULL,
                 updated_at = EXCLUDED.updated_at
             WHERE k.state = 'released' OR (k.state = 'completed' AND k.expires_at <= $4)
           RETURNING key`,
          [key, print, leaseUntil, now],
        );
        if (claimed.rowCount === 1) return { status: 'claimed' };

        const { rows: [row] } = await client.query(
          `SELECT fingerprint, state, response, lease_until FROM ${table} WHERE key = $1 FOR UPDATE`,
          [key],
        );
        if (row.fingerprint !== print) return { status: 'payload_mismatch' };
        if (row.state === 'completed') return { status: 'replay', response: row.response };
        if (row.state === 'unknown') return { status: 'unknown' };
        if (new Date(row.lease_until) > now) return { status: 'in_progress' };
        await client.query(
          `UPDATE ${table} SET state = 'unknown', unknown_since = $2, lease_until = NULL, updated_at = $2 WHERE key = $1`,
          [key, now],
        );
        return { status: 'unknown' };
      });
    },

    async complete(key, body, response, { ttlMs = DEFAULT_TTL_MS } = {}) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + Math.max(1000, Number(ttlMs) || DEFAULT_TTL_MS));
      // A response already stored for this claim is kept, as the Redis store did.
      const { rows } = await pool.query(
        `UPDATE ${table}
            SET state = 'completed',
                response = CASE WHEN state = 'completed' THEN response ELSE $3::jsonb END,
                expires_at = CASE WHEN state = 'completed' THEN expires_at ELSE $4 END,
                lease_until = NULL, updated_at = $5
          WHERE key = $1 AND fingerprint = $2 AND state IN ('processing', 'unknown', 'completed')
          RETURNING key`,
        [key, fingerprint(body), JSON.stringify(response ?? null), expiresAt, now],
      );
      if (rows.length !== 1) throw new Error('Idempotency claim was lost before its response could be stored');
    },

    async markUnknown(key, body) {
      const now = new Date();
      const { rows } = await pool.query(
        `UPDATE ${table}
            SET state = CASE WHEN state = 'completed' THEN state ELSE 'unknown' END,
                unknown_since = CASE WHEN state = 'completed' THEN unknown_since ELSE COALESCE(unknown_since, $3) END,
                lease_until = CASE WHEN state = 'completed' THEN lease_until ELSE NULL END,
                updated_at = $3
          WHERE key = $1 AND fingerprint = $2 AND state IN ('processing', 'unknown', 'completed')
          RETURNING key`,
        [key, fingerprint(body), now],
      );
      if (rows.length !== 1) throw new Error('Idempotency claim was lost before its outcome could be recorded');
    },

    async release(key, body) {
      const print = fingerprint(body);
      const released = await pool.query(
        `UPDATE ${table} SET state = 'released', lease_until = NULL, updated_at = now()
          WHERE key = $1 AND fingerprint = $2 AND state = 'processing'`,
        [key, print],
      );
      if (released.rowCount === 1) return;
      const { rows } = await pool.query(`SELECT fingerprint FROM ${table} WHERE key = $1`, [key]);
      if (rows.length === 1 && rows[0].fingerprint !== print) {
        throw new Error('Idempotency claim payload changed before release');
      }
    },
  };
}

/** Create a fixed-window limiter in `<schema>.rate_limit_windows`; memory outside production without a database. */
function createSharedRateLimitStore(options) {
  const pool = resolvePool(options);
  if (!pool) return createMemoryRateLimitStore();
  const table = `${options.schema}.rate_limit_windows`;

  return {
    async consume(key, { limit, windowMs }) {
      const window = Math.max(1000, Number(windowMs) || 60_000);
      const max = Math.max(1, Number(limit) || 1);
      const now = new Date();
      const { rows: [row] } = await pool.query(
        `INSERT INTO ${table} AS w (key, count, reset_at)
         VALUES ($1, 1, $2::timestamptz + make_interval(secs => $3::double precision / 1000))
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN w.reset_at <= $2 THEN 1 ELSE w.count + 1 END,
           reset_at = CASE WHEN w.reset_at <= $2 THEN EXCLUDED.reset_at ELSE w.reset_at END
         RETURNING count, reset_at`,
        [key, now, window],
      );
      const count = Number(row.count);
      return { allowed: count <= max, remaining: Math.max(0, max - count), resetAt: new Date(row.reset_at).getTime() };
    },
  };
}

module.exports = { createSharedIdempotencyStore, createSharedRateLimitStore };
