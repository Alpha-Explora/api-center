import { Global, Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { DatabaseModule } from "@database/database.module";
import { RegistryModule } from "@registry/registry.module";
import { AnalyticsController } from "./analytics.controller";
import { AuditEventsService } from "./audit-events.service";
import { GatewayTrafficService } from "./gateway-traffic.service";
import { SharedServiceUsageService } from "./shared-service-usage.service";

@Global()
@Module({
  imports: [AuthModule, DatabaseModule, RegistryModule],
  controllers: [AnalyticsController],
  providers: [
    AuditEventsService,
    GatewayTrafficService,
    SharedServiceUsageService,
  ],
  exports: [
    AuditEventsService,
    GatewayTrafficService,
    SharedServiceUsageService,
  ],
})
export class AnalyticsModule {}
