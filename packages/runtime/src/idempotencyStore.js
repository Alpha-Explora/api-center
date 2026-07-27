function createMemoryIdempotencyStore({ now = () => Date.now() } = {}) {
  const entries = new Map();

  async function get(key) {
    const entry = entries.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  async function set(key, value, { ttlMs = 24 * 60 * 60 * 1000 } = {}) {
    const resolvedTtl = Number(ttlMs || 0);
    entries.set(key, {
      value,
      expiresAt: now() + (Number.isFinite(resolvedTtl) && resolvedTtl > 0
        ? resolvedTtl
        : 24 * 60 * 60 * 1000),
    });
  }

  return { get, set };
}

module.exports = { createMemoryIdempotencyStore };
