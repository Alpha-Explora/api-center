import { Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { RegistryModule } from "../registry/registry.module";
import { GovernanceModule } from "@governance/governance.module";
import { PaymentsModule } from "@payments/payments.module";
import { ProjectOverviewController } from "./project-overview.controller";
import { ProjectOverviewService } from "./project-overview.service";

@Module({
  imports: [AuthModule, RegistryModule, GovernanceModule, PaymentsModule],
  controllers: [ProjectOverviewController],
  providers: [ProjectOverviewService],
})
export class ProjectOverviewModule {}
