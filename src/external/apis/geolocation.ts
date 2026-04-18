// =============================================================================
// src/external/apis/geolocation.ts — Geolocation API Configuration
// =============================================================================

import { ExternalApiConfig } from '../../types';
import { ConfigService } from '../../config/config.service';

export function createGeolocationApi(config: ConfigService): ExternalApiConfig {
  return {
    name: 'geolocation',
    displayName: 'Google Geolocation API',
    baseUrl: config.external.geolocation.url,
    authType: 'apiKey',
    authHeader: 'X-Goog-Api-Key',
    authValue: config.external.geolocation.key,
    timeout: 10_000,
    rateLimit: { windowMs: 60_000, max: 100 },
    healthEndpoint: '/geolocation/v1/geolocate',
  };
}
