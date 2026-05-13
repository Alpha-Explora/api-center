// =============================================================================
// src/shared-services/shared-services.module.ts — Shared Platform Services Module
// =============================================================================

import { Module } from "@nestjs/common";
import { SharedServicesController } from "./shared-services.controller";
import { AuthModule } from "../auth/auth.module";
import { RegistryModule } from "../registry/registry.module";
import { AnalyticsModule } from "../analytics/analytics.module";

@Module({
  imports: [AuthModule, RegistryModule, AnalyticsModule],
  controllers: [SharedServicesController],
})
export class SharedServicesModule {}
