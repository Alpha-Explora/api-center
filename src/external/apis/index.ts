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
import { createGeotaggingApi } from './geotagging';
import { createGeofencingApi } from './geofencing';
import { createKafkaApi } from './kafka';

/**
 * Build the external API config map from centralised ConfigService.
 * Called once during ExternalService.onModuleInit().
 */
export function buildExternalApis(config: ConfigService): ExternalApiConfigMap {
  const apis: ExternalApiConfigMap = {
    geolocation: createGeolocationApi(config),
    geotagging: createGeotaggingApi(config),
    geofencing: createGeofencingApi(config),
  };

  if (config.external.kafka.enabled) {
    apis.kafka = createKafkaApi(config);
  }

  return apis;
}

export { createGeolocationApi, createGeotaggingApi, createGeofencingApi, createKafkaApi };
