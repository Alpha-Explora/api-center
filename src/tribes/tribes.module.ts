// =============================================================================
// src/tribes/tribes.module.ts — Tribes NestJS Module
// =============================================================================

import { Module } from "@nestjs/common";
import { TribesController } from "./tribes.controller";
import { AuthModule } from "../auth/auth.module";
import { RegistryModule } from "../registry/registry.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { QuotasModule } from "../quotas/quotas.module";
import { PolicyEngineModule } from "../policy/policy-engine.module";

@Module({
  imports: [
    AuthModule,
    RegistryModule,
    AnalyticsModule,
    QuotasModule,
    PolicyEngineModule,
  ],
  controllers: [TribesController],
})
export class TribesModule {}
