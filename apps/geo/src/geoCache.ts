import { createMemoryCacheStore, CacheStore } from '@apicenter/runtime';

function normalizeText(value?: string | null): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeNumber(value: number | string): string {
  return Number(value).toFixed(6);
}

export interface GeoCacheInput {
  type: 'geocode' | 'reverse';
  address?: string;
  latitude?: number;
  longitude?: number;
  language?: string;
  region?: string;
  resultType?: string;
  locationType?: string;
}

export interface GeoCacheOptions {
  ttlMs?: number;
  store?: CacheStore;
}

export function createGeoCache({
  ttlMs = Number(process.env.GEO_CACHE_TTL_MS || 5 * 60 * 1000),
  store = createMemoryCacheStore(),
}: GeoCacheOptions = {}) {
  const inFlight = new Map<string, Promise<any>>();

  function keyFor(input: GeoCacheInput): string {
    if (input.type === 'reverse') {
      return [
        'geo',
        'reverse',
        normalizeNumber(input.latitude ?? 0),
        normalizeNumber(input.longitude ?? 0),
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

  async function getOrLoad<T>(input: GeoCacheInput, loader: () => Promise<T>): Promise<T & { cacheStatus: string }> {
    const key = keyFor(input);
    const cached = await store.get(key);
    if (cached) {
      return { ...cached, cacheStatus: 'hit' };
    }

    if (inFlight.has(key)) {
      const value = await inFlight.get(key)!;
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
