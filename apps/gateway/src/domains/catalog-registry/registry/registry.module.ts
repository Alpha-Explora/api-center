// =============================================================================
// src/registry/registry.module.ts — Registry NestJS Module
// =============================================================================

import { Module, forwardRef } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { RegistryService } from "./registry.service";
import { RegistryController } from "./registry.controller";
import { HealthMonitorService } from "./health-monitor.service";
import { RegistryBootstrapService } from "./registry-bootstrap.service";
import { TribeSecretResolverService } from "./tribe-secret-resolver.service";
import { PostgresRegistryStoreService } from "./postgres-registry-store.service";
import { RegistrationRequestsController } from "./registration-requests.controller";
import { RegistrationRequestsService } from "./registration-requests.service";
import { VaultModule } from "@auth/vault.module";
import { AuthModule } from "@auth/auth.module";
import { DatabaseModule } from "@database/database.module";
import { TribeSecretRotationService } from "@secrets/tribe-secret-rotation.service";
import { ApprovalsModule } from "@approvals/approvals.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    VaultModule,
    forwardRef(() => ApprovalsModule),
    DatabaseModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [RegistryController, RegistrationRequestsController],
  providers: [
    RegistryService,
    RegistrationRequestsService,
    HealthMonitorService,
    RegistryBootstrapService,
    TribeSecretResolverService,
    TribeSecretRotationService,
    PostgresRegistryStoreService,
  ],
  exports: [RegistryService],
})
export class RegistryModule {}
