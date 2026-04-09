// =============================================================================
// src/external/apis/kafka.ts — Kafka REST Proxy Configuration
// =============================================================================

import { ExternalApiConfig } from '../../types';
import { ConfigService } from '../../config/config.service';

export function createKafkaApi(config: ConfigService): ExternalApiConfig {
  return {
    name: 'kafka',
    displayName: 'Kafka REST Proxy',
    baseUrl: config.external.kafka.url,
    authType: 'apiKey',
    authHeader: 'X-APICENTER-KAFKA-KEY',
    authValue: config.external.kafka.apiKey,
    timeout: 15_000,
    rateLimit: { windowMs: 60_000, max: 300 },
    healthEndpoint: '/v3/clusters',
    description: 'Kafka HTTP bridge used by tribe services via APICenter external routing',
  };
}
