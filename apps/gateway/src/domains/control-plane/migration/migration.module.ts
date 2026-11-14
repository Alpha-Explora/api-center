import { Module } from "@nestjs/common";
import { DatabaseModule } from "@database/database.module";
import { RegistryModule } from "@registry/registry.module";
import { QuotasModule } from "@quotas/quotas.module";
import { EntitlementsModule } from "@entitlements/entitlements.module";
import { PaymentsModule } from "@payments/payments.module";
import { ControlPlaneModule } from "../control-plane.module";
import { MigrationController } from "./migration.controller";
import { LegacyMigrationService } from "./legacy-migration.service";

/** Inventory, backfill, cutover and rollback of legacy tribes, projects and services. */
@Module({
  imports: [DatabaseModule, RegistryModule, QuotasModule, EntitlementsModule, PaymentsModule, ControlPlaneModule],
  controllers: [MigrationController],
  providers: [LegacyMigrationService],
})
export class MigrationModule {}
