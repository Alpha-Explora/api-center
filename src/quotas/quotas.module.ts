import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConfigModule } from "../config/config.module";
import { DatabaseModule } from "../database/database.module";
import { TribeQuotaAdminController } from "./tribe-quota-admin.controller";
import { TribeQuotaEnforcerService } from "./tribe-quota-enforcer.service";
import { TribeQuotaPolicyService } from "./tribe-quota-policy.service";
import { TribeQuotaUsageController } from "./tribe-quota-usage.controller";

@Global()
@Module({
  imports: [AuthModule, DatabaseModule, ConfigModule],
  controllers: [TribeQuotaAdminController, TribeQuotaUsageController],
  providers: [TribeQuotaPolicyService, TribeQuotaEnforcerService],
  exports: [TribeQuotaPolicyService, TribeQuotaEnforcerService],
})
export class QuotasModule {}
