const Redis = require('ioredis');
const { createMemoryIdempotencyStore } = require('./idempotencyStore');
const { createMemoryRateLimitStore } = require('./rateLimitStore');
const { createHash } = require('node:crypto');

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CLAIM_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  local record = {
    fingerprint = ARGV[1],
    state = 'processing',
    leaseUntil = tonumber(ARGV[2]) + tonumber(ARGV[3])
  }
  redis.call('SET', KEYS[1], cjson.encode(record))
  return { 'claimed', '' }
end

local record = cjson.decode(raw)
if record.fingerprint ~= ARGV[1] then return { 'payload_mismatch', '' } end
if record.state == 'completed' then return { 'replay', cjson.encode(record.response) } end
if record.state == 'unknown' then return { 'unknown', '' } end
if tonumber(record.leaseUntil or 0) > tonumber(ARGV[2]) then
  return { 'in_progress', '' }
end

record.state = 'unknown'
record.unknownSince = tonumber(ARGV[2])
record.leaseUntil = nil
redis.call('SET', KEYS[1], cjson.encode(record))
return { 'unknown', '' }
`;

const COMPLETE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if record.fingerprint ~= ARGV[1] then return -1 end
if record.state == 'completed' then return 1 end
record.state = 'completed'
record.response = cjson.decode(ARGV[2])
record.completedAt = tonumber(ARGV[3])
record.leaseUntil = nil
redis.call('SET', KEYS[1], cjson.encode(record), 'PX', ARGV[4])
return 1
`;

const MARK_UNKNOWN_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if record.fingerprint ~= ARGV[1] then return -1 end
if record.state == 'completed' then return 1 end
record.state = 'unknown'
record.unknownSince = record.unknownSince or tonumber(ARGV[2])
record.leaseUntil = nil
redis.call('SET', KEYS[1], cjson.encode(record))
return 1
`;

const RELEASE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if record.fingerprint ~= ARGV[1] then return -1 end
if record.state ~= 'processing' then return 0 end
return redis.call('DEL', KEYS[1])
`;

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

function parseClaimResult(result) {
  const [status, rawResponse] = result;
  return status === 'replay'
    ? { status, response: JSON.parse(rawResponse) }
    : { status };
}

function redisConnection(url) {
  if (!url) {
    if (process.env.NODE_ENV === 'production') throw new Error('Redis URL is required for shared service state');
    return null;
  }
  const client = new Redis(url, { maxRetriesPerRequest: 1 });
  client.on('error', () => undefined);
  return client;
}

/** Create a namespaced Redis idempotency store, failing closed in production without Redis. */
function createSharedIdempotencyStore({ url, namespace }) {
  const redis = redisConnection(url);
  if (!redis) return createMemoryIdempotencyStore();
  const keyFor = (key) => `${namespace}:idempotency:${key}`;
  return {
    async claim(key, body, { leaseMs = DEFAULT_LEASE_MS } = {}) {
      const result = await redis.eval(
        CLAIM_SCRIPT,
        1,
        keyFor(key),
        fingerprint(body),
        Date.now(),
        Math.max(1, Number(leaseMs) || DEFAULT_LEASE_MS),
      );
      return parseClaimResult(result);
    },
    async complete(key, body, response, { ttlMs = DEFAULT_TTL_MS } = {}) {
      const result = Number(await redis.eval(
        COMPLETE_SCRIPT,
        1,
        keyFor(key),
        fingerprint(body),
        JSON.stringify(response),
        Date.now(),
        Math.max(1000, Number(ttlMs) || DEFAULT_TTL_MS),
      ));
      if (result !== 1) throw new Error('Idempotency claim was lost before its response could be stored');
    },
    async markUnknown(key, body) {
      const result = Number(await redis.eval(
        MARK_UNKNOWN_SCRIPT,
        1,
        keyFor(key),
        fingerprint(body),
        Date.now(),
      ));
      if (result !== 1) throw new Error('Idempotency claim was lost before its outcome could be recorded');
    },
    async release(key, body) {
      const result = Number(await redis.eval(
        RELEASE_SCRIPT,
        1,
        keyFor(key),
        fingerprint(body),
      ));
      if (result === -1) throw new Error('Idempotency claim payload changed before release');
    },
  };
}

const RATE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

/** Create a Redis-backed fixed-window rate-limit store for shared runtimes. */
function createSharedRateLimitStore({ url, namespace }) {
  const redis = redisConnection(url);
  if (!redis) return createMemoryRateLimitStore();
  return {
    async consume(key, { limit, windowMs }) {
      const window = Math.max(1000, Number(windowMs) || 60000);
      const max = Math.max(1, Number(limit) || 1);
      const [count, ttl] = await redis.eval(RATE_SCRIPT, 1, `${namespace}:rate:${key}`, window);
      return { allowed: count <= max, remaining: Math.max(0, max - count), resetAt: Date.now() + Math.max(0, ttl) };
    },
  };
}

module.exports = { createSharedIdempotencyStore, createSharedRateLimitStore };
