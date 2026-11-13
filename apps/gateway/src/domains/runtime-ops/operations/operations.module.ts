import { Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { DatabaseModule } from "@database/database.module";
import { GovernanceModule } from "@governance/governance.module";
import { RegistryModule } from "@registry/registry.module";
import { PaymentsModule } from "../../payments/payments.module";
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
import { VerificationEvidenceService } from "./verification-evidence.service";
import { VerificationEvidenceController } from "./verification-evidence.controller";
import { RequestDiagnosticsController } from "./request-diagnostics.controller";
import { RuntimeDeploymentObserver } from "./runtime-deployment-observer.service";

@Module({
  imports: [
    AuthModule,
    RegistryModule,
    PaymentsModule,
    DatabaseModule,
    GovernanceModule,
  ],
  controllers: [
    RequestDiagnosticsController,
    VerificationEvidenceController,
    ConsumerScorecardController,
    EmergencyControlController,
    GovernanceDriftController,
    PromotionEvidenceBundleController,
    RuntimeDependencyMapController,
    ServiceLifecycleEvidenceController,
  ],
  providers: [
    RuntimeDeploymentObserver,
    VerificationEvidenceService,
    ConsumerScorecardService,
    EmergencyControlService,
    GovernanceDriftService,
    PromotionEvidenceBundleService,
    RuntimeDependencyMapService,
    ServiceLifecycleEvidenceService,
  ],
  exports: [
    VerificationEvidenceService,
    ConsumerScorecardService,
    EmergencyControlService,
    GovernanceDriftService,
    PromotionEvidenceBundleService,
    RuntimeDependencyMapService,
    ServiceLifecycleEvidenceService,
  ],
})
export class OperationsModule {}
