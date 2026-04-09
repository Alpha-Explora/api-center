// =============================================================================
// src/external/apis/index.ts — External API Config Barrel
// =============================================================================
// HTTP-based external dependencies are configured here.
// Payment, SMS, and Email are platform-owned shared services registered
// via the service registry and routed through /api/v1/shared/*.
// =============================================================================

import { ConfigService } from '../../config/config.service';
import { ExternalApiConfigMap } from '../../types';
import { createGeolocationApi } from './geolocation';
import { createGeofencingApi } from './geofencing';
import { createKafkaApi } from './kafka';

/**
 * Build the external API config map from centralised ConfigService.
 * Called once during ExternalService.onModuleInit().
 */
export function buildExternalApis(config: ConfigService): ExternalApiConfigMap {
  return {
    geolocation: createGeolocationApi(config),
    geofencing: createGeofencingApi(config),
    kafka: createKafkaApi(config),
  };
}

export { createGeolocationApi, createGeofencingApi, createKafkaApi };
