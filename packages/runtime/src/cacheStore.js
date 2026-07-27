function createMemoryCacheStore({ now = () => Date.now() } = {}) {
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

  async function set(key, value, { ttlMs } = {}) {
    const resolvedTtl = Number(ttlMs || 0);
    if (!Number.isFinite(resolvedTtl) || resolvedTtl <= 0) {
      return;
    }

    entries.set(key, {
      value,
      expiresAt: now() + resolvedTtl,
    });
  }

  async function deleteKey(key) {
    entries.delete(key);
  }

  return {
    get,
    set,
    delete: deleteKey,
  };
}

module.exports = { createMemoryCacheStore };
