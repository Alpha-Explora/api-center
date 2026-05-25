import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DataPipelineModule } from "../data-pipeline/data-pipeline.module";
import { KafkaModule } from "../kafka/kafka.module";
import { MetricsModule } from "../metrics/metrics.module";
import { PolicyEngineModule } from "../policy/policy-engine.module";
import { QuotasModule } from "../quotas/quotas.module";
import { SharedModule } from "../shared/shared.module";
import { KafkaGovernanceController } from "./kafka-governance.controller";
import { KafkaGovernanceService } from "./kafka-governance.service";

@Module({
  imports: [
    AuthModule,
    DataPipelineModule,
    KafkaModule,
    MetricsModule,
    PolicyEngineModule,
    QuotasModule,
    SharedModule,
  ],
  controllers: [KafkaGovernanceController],
  providers: [KafkaGovernanceService],
  exports: [KafkaGovernanceService],
})
export class KafkaGovernanceModule {}
