// =============================================================================
// src/registry/registry.module.ts — Registry NestJS Module
// =============================================================================

import { Module, forwardRef } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { RegistryService } from "./registry.service";
import { RegistryController } from "./registry.controller";
import { HealthMonitorService } from "./health-monitor.service";
import { RegistryBootstrapService } from "./registry-bootstrap.service";
import { ServiceSecretResolverService } from "./service-secret-resolver.service";
import { PostgresRegistryStoreService } from "./postgres-registry-store.service";
import { RegistrationRequestsController } from "./registration-requests.controller";
import { RegistrationRequestsService } from "./registration-requests.service";
import { TenancyService } from "./tenancy.service";
import { TenancyController } from "./tenancy.controller";
import { PostgresTenancyStoreService } from "./postgres-tenancy-store.service";
import { TenancyDirectoryService } from "./tenancy-directory.service";
import { TENANCY_DIRECTORY } from "./tenancy.types";
import { VaultModule } from "@auth/vault.module";
import { AuthModule } from "@auth/auth.module";
import { DatabaseModule } from "@database/database.module";
import { TribeSecretRotationService } from "@secrets/tribe-secret-rotation.service";
import { ApprovalsModule } from "@approvals/approvals.module";
import { RegistryChangeRequestModule } from "@change-requests/registry-change-request.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    VaultModule,
    forwardRef(() => ApprovalsModule),
    DatabaseModule,
    RegistryChangeRequestModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [RegistryController, RegistrationRequestsController, TenancyController],
  providers: [
    RegistryService,
    TenancyService,
    PostgresTenancyStoreService,
    TenancyDirectoryService,
    { provide: TENANCY_DIRECTORY, useExisting: TenancyDirectoryService },
    RegistrationRequestsService,
    HealthMonitorService,
    RegistryBootstrapService,
    ServiceSecretResolverService,
    TribeSecretRotationService,
    PostgresRegistryStoreService,
  ],
  exports: [RegistryService, TenancyService, TENANCY_DIRECTORY],
})
export class RegistryModule {}
