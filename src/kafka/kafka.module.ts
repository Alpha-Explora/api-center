// =============================================================================
// src/kafka/kafka.module.ts — Kafka module
// =============================================================================

import { Global, Module } from '@nestjs/common';
import { KafkaService } from './kafka.service';
import { MetricsModule } from '../metrics/metrics.module';

@Global()
@Module({
  imports: [MetricsModule],
  providers: [KafkaService],
  exports: [KafkaService],
})
export class KafkaModule {}
