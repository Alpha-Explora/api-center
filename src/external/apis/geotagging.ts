// =============================================================================
// src/external/apis/geotagging.ts — Geotagging API configuration
// =============================================================================
// Provider: configurable via GEOTAGGING_API_URL + GEOTAGGING_API_KEY.
// Without a key, auth header is omitted (useful for unauthenticated providers).
// =============================================================================

import { ExternalApiConfig } from "../../types";
import { ConfigService } from "../../config/config.service";

export function createGeotaggingApi(config: ConfigService): ExternalApiConfig {
  const { url, key } = config.external.geotagging;
  return {
    name: "geotagging",
    displayName: "Geotagging API",
    baseUrl: url,
    authType: key ? "apiKey" : "none",
    authHeader: key ? "X-API-Key" : undefined,
    authValue: key || undefined,
    timeout: 10_000,
    rateLimit: { windowMs: 60_000, max: 100 },
    healthEndpoint: "/v1/geotags",
  };
}
