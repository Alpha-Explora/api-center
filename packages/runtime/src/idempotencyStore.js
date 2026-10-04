const { createHash } = require('node:crypto');

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Creates a single-process idempotency store for local development and tests. */
function createMemoryIdempotencyStore({ now = () => Date.now() } = {}) {
  const entries = new Map();

  async function claim(key, body, { leaseMs = DEFAULT_LEASE_MS } = {}) {
    const bodyFingerprint = fingerprint(body);
    let entry = entries.get(key);

    if (entry?.state === 'completed' && entry.expiresAt <= now()) {
      entries.delete(key);
      entry = undefined;
    }

    if (!entry) {
      entries.set(key, {
        fingerprint: bodyFingerprint,
        state: 'processing',
        leaseUntil: now() + Math.max(1, leaseMs),
      });
      return { status: 'claimed' };
    }

    if (entry.fingerprint !== bodyFingerprint) return { status: 'payload_mismatch' };
    if (entry.state === 'completed') {
      return { status: 'replay', response: clone(entry.response) };
    }
    if (entry.state === 'unknown') return { status: 'unknown' };
    if (entry.leaseUntil > now()) return { status: 'in_progress' };

    entry.state = 'unknown';
    entry.unknownSince = now();
    delete entry.leaseUntil;
    return { status: 'unknown' };
  }

  async function complete(key, body, response, { ttlMs = DEFAULT_TTL_MS } = {}) {
    const entry = entries.get(key);
    if (!entry || entry.fingerprint !== fingerprint(body)) {
      throw new Error('Idempotency claim was lost before its response could be stored');
    }
    const ttl = Math.max(1, Number(ttlMs) || DEFAULT_TTL_MS);
    entries.set(key, {
      fingerprint: entry.fingerprint,
      state: 'completed',
      response: clone(response),
      expiresAt: now() + ttl,
    });
  }

  async function markUnknown(key, body) {
    const entry = entries.get(key);
    if (!entry || entry.fingerprint !== fingerprint(body)) {
      throw new Error('Idempotency claim was lost before its outcome could be recorded');
    }
    if (entry.state === 'completed') return;
    entry.state = 'unknown';
    entry.unknownSince = entry.unknownSince ?? now();
    delete entry.leaseUntil;
    delete entry.expiresAt;
  }

  async function release(key, body) {
    const entry = entries.get(key);
    if (entry?.state === 'processing' && entry.fingerprint === fingerprint(body)) {
      entries.delete(key);
    }
  }

  return { claim, complete, markUnknown, release };
}

/**
 * Builds a non-reversible key scoped to one authenticated consumer, tenant,
 * environment, service operation, and caller-provided idempotency key.
 */
function createScopedIdempotencyKey({
  namespace,
  route,
  clientKey,
  sourceServiceId,
  tribeId,
  environment,
}) {
  const key = typeof clientKey === 'string' ? clientKey.trim() : '';
  if (key.length < 16 || key.length > 255) return null;

  const production = process.env.NODE_ENV === 'production';
  if (production && (!sourceServiceId || !tribeId || !environment)) return null;

  const identity = {
    namespace,
    route,
    sourceServiceId: sourceServiceId || 'local',
    tribeId: tribeId || 'local',
    environment: environment || process.env.NODE_ENV || 'development',
    key,
  };
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

module.exports = { createMemoryIdempotencyStore, createScopedIdempotencyKey };
