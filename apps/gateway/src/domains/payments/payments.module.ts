import { Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { DatabaseModule } from "@database/database.module";
import { RegistryModule } from "@registry/registry.module";
import { PaymentsController, PaymentApiKeyService } from "./features/payment-facade";
import { PaymentCatalogManagementController, PaymentCatalogManagementService } from "./features/catalog-management";
import { PaymentConsumerManagementController, PaymentConsumerManagementService } from "./features/consumer-management";
import {
  PaymentPubSubProvisioningController,
  PaymentPubSubProvisioningService,
  PaymentPubSubIamProvisioningService,
} from "./features/pubsub-provisioning";
import { PaymentAuthGuard } from "./shared/payment-auth.guard";
import { PaymentIdempotencyService } from "./shared/payment-idempotency.service";
import { PaymentRecordsManagementController } from "./features/records-management/payment-records-management.controller";
import { PaymentRecordsManagementService } from "./features/records-management/payment-records-management.service";

@Module({
  imports: [AuthModule, DatabaseModule, RegistryModule],
  controllers: [
    PaymentsController,
    PaymentConsumerManagementController,
    PaymentCatalogManagementController,
    PaymentPubSubProvisioningController,
    PaymentRecordsManagementController,
  ],
  providers: [
    PaymentApiKeyService,
    PaymentAuthGuard,
    PaymentCatalogManagementService,
    PaymentConsumerManagementService,
    PaymentIdempotencyService,
    PaymentPubSubIamProvisioningService,
    PaymentPubSubProvisioningService,
    PaymentRecordsManagementService,
  ],
  exports: [
    PaymentApiKeyService,
  ],
})
export class PaymentsModule {}
