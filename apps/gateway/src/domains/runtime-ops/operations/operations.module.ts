import { Module } from "@nestjs/common";
import { ApprovalsModule } from "@approvals/approvals.module";
import { AuthModule } from "@auth/auth.module";
import { DatabaseModule } from "@database/database.module";
import { EntitlementsModule } from "@entitlements/entitlements.module";
import { QuotasModule } from "@quotas/quotas.module";
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
    QuotasModule,
    DatabaseModule,
    EntitlementsModule,
    ApprovalsModule,
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
