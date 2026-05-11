// =============================================================================
// src/external/apis/geolocation.ts — Google Geolocation API configuration
// =============================================================================
// Provider: Google Geolocation API (https://www.googleapis.com)
// Set GEOLOCATION_API_URL + GEOLOCATION_API_KEY in env to use a different provider.
// Without a key, the gateway skips the auth header (useful for local testing only).
// =============================================================================

import { ExternalApiConfig } from '../../types';
import { ConfigService } from '../../config/config.service';

export function createGeolocationApi(config: ConfigService): ExternalApiConfig {
  const { url, key } = config.external.geolocation;
  return {
    name: 'geolocation',
    displayName: 'Geolocation API',
    baseUrl: url,
    authType: key ? 'apiKey' : 'none',
    authHeader: key ? 'X-Goog-Api-Key' : undefined,
    authValue: key || undefined,
    timeout: 10_000,
    rateLimit: { windowMs: 60_000, max: 100 },
    healthEndpoint: '/geolocation/v1/geolocate',
  };
}
