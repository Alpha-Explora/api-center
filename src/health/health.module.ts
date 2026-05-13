// =============================================================================
// src/health/health.module.ts — Health NestJS Module
// =============================================================================

import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { HealthController } from "./health.controller";
import { RegistryModule } from "../registry/registry.module";
import { ExternalModule } from "../external/external.module";
import { AuthModule } from "../auth/auth.module";
import { AnalyticsModule } from "../analytics/analytics.module";

@Module({
  imports: [
    TerminusModule,
    RegistryModule,
    ExternalModule,
    AuthModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
})
export class HealthModule {}
