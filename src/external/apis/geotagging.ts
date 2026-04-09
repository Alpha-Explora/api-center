// =============================================================================
// src/external/apis/geotagging.ts — Geotagging API Configuration
// =============================================================================

import { ExternalApiConfig } from '../../types';
import { ConfigService } from '../../config/config.service';

export function createGeotaggingApi(config: ConfigService): ExternalApiConfig {
  return {
    name: 'geotagging',
    displayName: 'Geotagging API',
    baseUrl: config.external.geotagging.url,
    authType: 'apiKey',
    authHeader: 'X-API-Key',
    authValue: config.external.geotagging.key,
    timeout: 10_000,
    rateLimit: { windowMs: 60_000, max: 75 },
    healthEndpoint: '/health',
  };
}
