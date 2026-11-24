// The geocoding interface (ADR-0010). Services call one GeocodingProvider; adapters translate a provider's
// answer into APICenter's neutral result. Timeouts, the circuit breaker and metrics wrap the interface here,
// so every adapter gets the same guards.
import { createCircuitBreaker, recordProviderMetric, withProviderTimeout } from '@apicenter/runtime';
import { createGoogleGeocodingAdapter } from './google-geocoding-adapter';

export type AddressComponents = {
  streetNumber?: string;
  street?: string;
  barangay?: string;
  city?: string;
  province?: string;
  region?: string;
  postalCode?: string;
  country: string;
};

export type GeocodingPrecision = 'exact' | 'street' | 'area' | 'approximate';

export type GeocodingResult = {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  components: AddressComponents;
  precision: GeocodingPrecision;
};

/**
 * Fields the public response still carries while they are deprecated (sunset 2027-03-01). Only the adapter that
 * produced them knows their meaning; remove this type with them.
 */
export type DeprecatedGeocodingFields = { placeId?: string; types: string[]; raw: unknown | null };

export type GeocodingAnswer = GeocodingResult & { deprecated: DeprecatedGeocodingFields };

export interface GeocodingProvider {
  /** The value of the deprecated `provider` response field. */
  readonly name: string;
  /** Whether the adapter has what it needs (for example, its key) to answer. */
  readonly configured: boolean;
  geocode(input: { address: string; language?: string; region?: string }): Promise<GeocodingAnswer>;
  /** `hints` are the deprecated resultType/locationType request fields, which only some providers honour. */
  reverse(input: { latitude: number; longitude: number; language?: string;
    hints?: { resultType?: string; locationType?: string } }): Promise<GeocodingAnswer>;
}

function mockAnswer(address = 'Manila, Philippines'): GeocodingAnswer {
  return {
    formattedAddress: address,
    latitude: 14.5995,
    longitude: 120.9842,
    components: { city: 'Manila', region: 'Metro Manila', country: 'PH' },
    precision: 'approximate',
    deprecated: { placeId: 'mock-place-id', types: ['locality', 'political'], raw: null },
  };
}

export function createMockGeocodingProvider(): GeocodingProvider {
  return {
    name: 'mock',
    configured: true,
    async geocode(input) { return mockAnswer(input.address); },
    async reverse() { return mockAnswer(); },
  };
}

/** The public geo response: the neutral result, plus the deprecated fields until their sunset. */
export function publicResult(provider: GeocodingProvider, answer: GeocodingAnswer) {
  const { deprecated, ...result } = answer;
  return { ...result, placeId: deprecated.placeId, types: deprecated.types, provider: provider.name, raw: deprecated.raw };
}

/** Wraps a provider with a timeout, a circuit breaker and latency metrics. */
export function guarded(provider: GeocodingProvider, env: NodeJS.ProcessEnv = process.env): GeocodingProvider {
  const timeoutMs = Number(env.GEO_PROVIDER_TIMEOUT_MS || 1500);
  const circuit = createCircuitBreaker({
    provider: provider.name,
    failureThreshold: Number(env.GEO_PROVIDER_FAILURE_THRESHOLD || 5),
    resetAfterMs: Number(env.GEO_PROVIDER_CIRCUIT_RESET_MS || 30_000),
  });
  const call = async (operation: 'geocode' | 'reverse_geocode', work: () => Promise<GeocodingAnswer>) => {
    const startedAt = Date.now();
    try {
      const answer = await circuit.exec(() => withProviderTimeout(work(), { timeoutMs, provider: provider.name, operation }));
      recordProviderMetric({ serviceId: 'geo', provider: provider.name, operation, status: 'success', latencyMs: Date.now() - startedAt });
      return answer;
    } catch (error) {
      recordProviderMetric({ serviceId: 'geo', provider: provider.name, operation, status: 'error', latencyMs: Date.now() - startedAt });
      throw error;
    }
  };
  return {
    name: provider.name,
    configured: provider.configured,
    geocode: (input) => call('geocode', () => provider.geocode(input)),
    reverse: (input) => call('reverse_geocode', () => provider.reverse(input)),
  };
}

/**
 * GEOCODING_PROVIDER selects the adapter: `google` or `mock`. Without it, Google is used when its key is set,
 * and the mock otherwise outside production.
 */
export function createGeocodingProvider(env: NodeJS.ProcessEnv = process.env): GeocodingProvider {
  const production = (env.NODE_ENV || 'development') === 'production';
  // Production never falls back to the mock: without a key, requests fail as not configured.
  const choice = env.GEOCODING_PROVIDER || (env.GOOGLE_MAPS_API_KEY || production ? 'google' : 'mock');
  if (choice === 'mock') {
    if (production) throw new Error('The mock geocoding provider is not allowed in production');
    return createMockGeocodingProvider();
  }
  if (choice === 'google') return guarded(createGoogleGeocodingAdapter(env), env);
  throw new Error(`Unknown GEOCODING_PROVIDER: ${choice}`);
}
