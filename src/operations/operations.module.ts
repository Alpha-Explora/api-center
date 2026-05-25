import { Module } from "@nestjs/common";
import { ApprovalsModule } from "../approvals/approvals.module";
import { DataPipelineModule } from "../data-pipeline/data-pipeline.module";
import { DatabaseModule } from "../database/database.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { QuotasModule } from "../quotas/quotas.module";
import { RegistryModule } from "../registry/registry.module";
import { ConsumerScorecardController } from "./consumer-scorecard.controller";
import { ConsumerScorecardService } from "./consumer-scorecard.service";
import { EmergencyControlController } from "./emergency-control.controller";
import { EmergencyControlService } from "./emergency-control.service";
import { GovernanceDriftController } from "./governance-drift.controller";
import { GovernanceDriftService } from "./governance-drift.service";
import { PromotionEvidenceBundleController } from "./promotion-evidence-bundle.controller";
import { PromotionEvidenceBundleService } from "./promotion-evidence-bundle.service";
import { RuntimeDependencyMapController } from "./runtime-dependency-map.controller";
import { RuntimeDependencyMapService } from "./runtime-dependency-map.service";

@Module({
  imports: [
    RegistryModule,
    QuotasModule,
    DatabaseModule,
    EntitlementsModule,
    ApprovalsModule,
    DataPipelineModule,
  ],
  controllers: [
    ConsumerScorecardController,
    EmergencyControlController,
    GovernanceDriftController,
    PromotionEvidenceBundleController,
    RuntimeDependencyMapController,
  ],
  providers: [
    ConsumerScorecardService,
    EmergencyControlService,
    GovernanceDriftService,
    PromotionEvidenceBundleService,
    RuntimeDependencyMapService,
  ],
  exports: [
    ConsumerScorecardService,
    EmergencyControlService,
    GovernanceDriftService,
    PromotionEvidenceBundleService,
    RuntimeDependencyMapService,
  ],
})
export class OperationsModule {}
