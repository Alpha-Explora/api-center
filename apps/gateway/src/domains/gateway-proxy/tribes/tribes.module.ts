// =============================================================================
// src/tribes/tribes.module.ts — Tribes NestJS Module
// =============================================================================

import { Module } from "@nestjs/common";
import { TribesController } from "./tribes.controller";
import { AuthModule } from "@auth/auth.module";
import { RegistryModule } from "@registry/registry.module";
import { AnalyticsModule } from "@analytics/analytics.module";
import { QuotasModule } from "@quotas/quotas.module";
import { PolicyEngineModule } from "@policy/policy-engine.module";
import { OperationsModule } from "@operations/operations.module";
import { ControlPlaneModule } from "@domains/control-plane/control-plane.module";
import { LegacyCallerDispatcher } from "../legacy-bridge/legacy-caller-dispatcher";

@Module({
  imports: [
    AuthModule,
    RegistryModule,
    AnalyticsModule,
    QuotasModule,
    PolicyEngineModule,
    OperationsModule,
    ControlPlaneModule,
  ],
  controllers: [TribesController],
  providers: [LegacyCallerDispatcher],
})
export class TribesModule {}
