const { createMemoryCacheStore } = require('@apicenter/runtime');

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeNumber(value) {
  return Number(value).toFixed(6);
}

function createGeoCache({
  ttlMs = Number(process.env.GEO_CACHE_TTL_MS || 5 * 60 * 1000),
  store = createMemoryCacheStore(),
} = {}) {
  const inFlight = new Map();

  function keyFor(input) {
    if (input.type === 'reverse') {
      return [
        'geo',
        'reverse',
        normalizeNumber(input.latitude),
        normalizeNumber(input.longitude),
        normalizeText(input.language),
        normalizeText(input.resultType),
        normalizeText(input.locationType),
      ].join(':');
    }

    return [
      'geo',
      'geocode',
      normalizeText(input.address),
      normalizeText(input.language),
      normalizeText(input.region),
    ].join(':');
  }

  async function getOrLoad(input, loader) {
    const key = keyFor(input);
    const cached = await store.get(key);
    if (cached) {
      return { ...cached, cacheStatus: 'hit' };
    }

    if (inFlight.has(key)) {
      const value = await inFlight.get(key);
      return { ...value, cacheStatus: 'miss' };
    }

    const pending = Promise.resolve()
      .then(loader)
      .then(async (value) => {
        await store.set(key, value, { ttlMs });
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, pending);
    const value = await pending;
    return { ...value, cacheStatus: 'miss' };
  }

  return {
    getOrLoad,
    keyFor,
  };
}

module.exports = { createGeoCache };
