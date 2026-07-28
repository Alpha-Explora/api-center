// =============================================================================
// src/kafka/kafka.module.ts — Kafka module
// =============================================================================

import { Global, Module } from "@nestjs/common";
import { KafkaService } from "./kafka.service";
import { AnalyticsModule } from "../analytics/analytics.module";
import { MetricsModule } from "../metrics/metrics.module";

@Global()
@Module({
  imports: [MetricsModule, AnalyticsModule],
  providers: [KafkaService],
  exports: [KafkaService],
})
export class KafkaModule {}
