import { Module } from "@nestjs/common";
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
  imports: [RegistryModule],
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
