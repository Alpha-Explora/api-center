import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { QuotasModule } from "../quotas/quotas.module";
import { RegistryModule } from "../registry/registry.module";
import { DeveloperPortalController } from "./developer-portal.controller";

@Module({
  imports: [AuthModule, RegistryModule, QuotasModule],
  controllers: [DeveloperPortalController],
})
export class DeveloperPortalModule {}
