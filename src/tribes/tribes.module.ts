// =============================================================================
// src/tribes/tribes.module.ts — Tribes NestJS Module
// =============================================================================

import { Module } from "@nestjs/common";
import { TribesController } from "./tribes.controller";
import { AuthModule } from "../auth/auth.module";
import { RegistryModule } from "../registry/registry.module";
import { AnalyticsModule } from "../analytics/analytics.module";

@Module({
  imports: [AuthModule, RegistryModule, AnalyticsModule],
  controllers: [TribesController],
})
export class TribesModule {}
