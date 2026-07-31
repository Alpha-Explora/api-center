import { Module } from "@nestjs/common";
import { ApprovalsModule } from "@approvals/approvals.module";
import { AuthModule } from "@auth/auth.module";
import { QuotasModule } from "@quotas/quotas.module";
import { RegistryModule } from "@registry/registry.module";
import { DeveloperPortalController } from "./developer-portal.controller";
import { DeveloperPortalRequestController } from "./developer-portal-request.controller";

@Module({
  imports: [ApprovalsModule, AuthModule, RegistryModule, QuotasModule],
  controllers: [DeveloperPortalController, DeveloperPortalRequestController],
})
export class DeveloperPortalModule {}
