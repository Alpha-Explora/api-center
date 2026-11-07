import { Module } from "@nestjs/common";
import { RegistryModule } from "../registry/registry.module";
import { GovernanceModule } from "@governance/governance.module";
import { PaymentsModule } from "@payments/payments.module";
import { ProjectOverviewController } from "./project-overview.controller";
import { ProjectOverviewService } from "./project-overview.service";
import { AuthModule } from "@auth/auth.module";
import { ConsumerSetupStatusController, OperatorProjectSetupStatusController } from "./project-setup-status.controller";
import { ProjectSetupStatusService } from "./project-setup-status.service";

@Module({
  imports: [RegistryModule, GovernanceModule, PaymentsModule, AuthModule],
  controllers: [ProjectOverviewController, ConsumerSetupStatusController, OperatorProjectSetupStatusController],
  providers: [ProjectOverviewService, ProjectSetupStatusService],
})
export class ProjectOverviewModule {}
