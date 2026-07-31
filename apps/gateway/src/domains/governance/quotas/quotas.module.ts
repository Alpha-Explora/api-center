import { Global, Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { ApprovalsModule } from "@approvals/approvals.module";
import { ConfigModule } from "@config/config.module";
import { TribeCostService } from "@costs/tribe-cost.service";
import { DatabaseModule } from "@database/database.module";
import { ForecastingModule } from "@forecasting/forecasting.module";
import { TribeQuotaAdminController } from "./tribe-quota-admin.controller";
import { TribeQuotaEnforcerService } from "./tribe-quota-enforcer.service";
import { TribeQuotaPolicyService } from "./tribe-quota-policy.service";
import { TribeQuotaUsageController } from "./tribe-quota-usage.controller";

@Global()
@Module({
  imports: [
    AuthModule,
    ApprovalsModule,
    DatabaseModule,
    ConfigModule,
    ForecastingModule,
  ],
  controllers: [TribeQuotaAdminController, TribeQuotaUsageController],
  providers: [
    TribeCostService,
    TribeQuotaPolicyService,
    TribeQuotaEnforcerService,
  ],
  exports: [TribeQuotaPolicyService, TribeQuotaEnforcerService],
})
export class QuotasModule {}
