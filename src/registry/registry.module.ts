// =============================================================================
// src/registry/registry.module.ts — Registry NestJS Module
// =============================================================================

import { Module, forwardRef } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { RegistryService } from "./registry.service";
import { RegistryController } from "./registry.controller";
import { HealthMonitorService } from "./health-monitor.service";
import { RegistryBootstrapService } from "./registry-bootstrap.service";
import { VaultModule } from "../auth/vault.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    VaultModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [RegistryController],
  providers: [RegistryService, HealthMonitorService, RegistryBootstrapService],
  exports: [RegistryService],
})
export class RegistryModule {}
