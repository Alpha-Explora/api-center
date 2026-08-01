import { Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { DatabaseModule } from "@database/database.module";
import { GovernanceModule } from "@governance";
import { RegistryModule } from "@registry/registry.module";
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
import { ServiceLifecycleEvidenceController } from "./service-lifecycle-evidence.controller";
import { ServiceLifecycleEvidenceService } from "./service-lifecycle-evidence.service";

@Module({
  imports: [
    AuthModule,
    RegistryModule,
    DatabaseModule,
    GovernanceModule,
  ],
  controllers: [
    ConsumerScorecardController,
    EmergencyControlController,
    GovernanceDriftController,
    PromotionEvidenceBundleController,
    RuntimeDependencyMapController,
    ServiceLifecycleEvidenceController,
  ],
  providers: [
    ConsumerScorecardService,
    EmergencyControlService,
    GovernanceDriftService,
    PromotionEvidenceBundleService,
    RuntimeDependencyMapService,
    ServiceLifecycleEvidenceService,
  ],
  exports: [
    ConsumerScorecardService,
    EmergencyControlService,
    GovernanceDriftService,
    PromotionEvidenceBundleService,
    RuntimeDependencyMapService,
    ServiceLifecycleEvidenceService,
  ],
})
export class OperationsModule {}
