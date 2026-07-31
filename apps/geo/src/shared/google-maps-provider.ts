import { createCircuitBreaker, withProviderTimeout, recordProviderMetric } from '@apicenter/runtime';

const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
const providerTimeoutMs = Number(process.env.GEO_PROVIDER_TIMEOUT_MS || 1500);
const nodeEnv = process.env.NODE_ENV || 'development';
const geocodingUrl =
  process.env.GOOGLE_MAPS_GEOCODING_URL ||
  'https://maps.googleapis.com/maps/api/geocode/json';

const googleMapsCircuit = createCircuitBreaker({
  provider: 'google_maps',
  failureThreshold: Number(process.env.GEO_PROVIDER_FAILURE_THRESHOLD || 5),
  resetAfterMs: Number(process.env.GEO_PROVIDER_CIRCUIT_RESET_MS || 30_000),
});

export function shouldUseMock(): boolean {
  return !googleMapsApiKey && nodeEnv !== 'production';
}

export function mockGeocode(address?: string) {
  return {
    formattedAddress: address || 'Manila, Philippines',
    latitude: 14.5995,
    longitude: 120.9842,
    placeId: 'mock-place-id',
    types: ['locality', 'political'],
    provider: 'mock',
    raw: null,
  };
}

export async function callGoogleGeocoding(params: Record<string, any>) {
  const url = new URL(geocodingUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set('key', googleMapsApiKey);

  const startedAt = Date.now();
  const response = await googleMapsCircuit.exec(() => withProviderTimeout(
    fetch(url.toString()),
    {
      timeoutMs: providerTimeoutMs,
      provider: 'google_maps',
      operation: params.latlng ? 'reverse_geocode' : 'geocode',
    },
  ));
  recordProviderMetric({
    serviceId: 'geo',
    provider: 'google_maps',
    operation: params.latlng ? 'reverse_geocode' : 'geocode',
    status: response.ok ? 'success' : 'error',
    latencyMs: Date.now() - startedAt,
  });
  const body: any = await response.json();

  if (!response.ok || body?.status !== 'OK') {
    const message = body?.error_message || body?.status || `HTTP ${response.status}`;
    throw new Error(message);
  }

  const firstResult = Array.isArray(body?.results) ? body.results[0] : undefined;
  if (!firstResult) {
    throw new Error('Google Maps returned no geocoding results.');
  }

  const location = firstResult?.geometry?.location || {};
  return {
    formattedAddress: firstResult?.formatted_address || '',
    latitude: Number(location.lat),
    longitude: Number(location.lng),
    placeId: firstResult?.place_id,
    types: Array.isArray(firstResult?.types) ? firstResult.types : [],
    provider: 'google-maps',
    raw: firstResult,
  };
}
