import { Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { RegistryModule } from "../registry/registry.module";
import { GovernanceModule } from "@governance/governance.module";
import { PaymentsModule } from "@payments/payments.module";
import { ProjectOverviewController } from "./project-overview.controller";
import { ProjectOverviewService } from "./project-overview.service";
import { ConsumerSetupStatusController, OperatorProjectSetupStatusController } from "./project-setup-status.controller";
import { ProjectSetupStatusService } from "./project-setup-status.service";

@Module({
  imports: [AuthModule, RegistryModule, GovernanceModule, PaymentsModule],
  controllers: [ProjectOverviewController, ConsumerSetupStatusController, OperatorProjectSetupStatusController],
  providers: [ProjectOverviewService, ProjectSetupStatusService],
})
export class ProjectOverviewModule {}
