// =============================================================================
// src/shared-services/shared-services.module.ts — Shared Platform Services Module
// =============================================================================

import { Module } from "@nestjs/common";
import { SharedServicesController } from "./shared-services.controller";
import { AuthModule } from "../auth/auth.module";
import { RegistryModule } from "../registry/registry.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { SharedServiceEventPublisher } from "./shared-service-event-publisher";

@Module({
  imports: [AuthModule, RegistryModule, AnalyticsModule],
  controllers: [SharedServicesController],
  providers: [SharedServiceEventPublisher],
})
export class SharedServicesModule {}
