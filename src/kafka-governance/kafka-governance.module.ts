import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { KafkaModule } from "../kafka/kafka.module";
import { MetricsModule } from "../metrics/metrics.module";
import { SharedModule } from "../shared/shared.module";
import { KafkaGovernanceController } from "./kafka-governance.controller";
import { KafkaGovernanceService } from "./kafka-governance.service";

@Module({
  imports: [AuthModule, KafkaModule, MetricsModule, SharedModule],
  controllers: [KafkaGovernanceController],
  providers: [KafkaGovernanceService],
  exports: [KafkaGovernanceService],
})
export class KafkaGovernanceModule {}
