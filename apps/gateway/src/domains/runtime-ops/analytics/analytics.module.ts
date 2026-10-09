import { Global, Module } from "@nestjs/common";
import { AuditModule } from "@audit/audit.module";
import { AuthModule } from "@auth/auth.module";
import { DatabaseModule } from "@database/database.module";
import { RegistryModule } from "@registry/registry.module";
import { AnalyticsController } from "./analytics.controller";
import { GatewayTrafficService } from "./gateway-traffic.service";
import { SharedServiceUsageService } from "./shared-service-usage.service";

@Global()
@Module({
  imports: [AuditModule, AuthModule, DatabaseModule, RegistryModule],
  controllers: [AnalyticsController],
  providers: [
    GatewayTrafficService,
    SharedServiceUsageService,
  ],
  exports: [
    GatewayTrafficService,
    SharedServiceUsageService,
  ],
})
export class AnalyticsModule {}
