import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AnalyticsController } from "./analytics.controller";
import { SharedServiceUsageService } from "./shared-service-usage.service";

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [SharedServiceUsageService],
  exports: [SharedServiceUsageService],
})
export class AnalyticsModule {}
