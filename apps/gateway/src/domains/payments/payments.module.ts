import { Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { DatabaseModule } from "@database/database.module";
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

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [
    PaymentsController,
    PaymentConsumerManagementController,
    PaymentCatalogManagementController,
    PaymentPubSubProvisioningController,
  ],
  providers: [
    PaymentApiKeyService,
    PaymentAuthGuard,
    PaymentCatalogManagementService,
    PaymentConsumerManagementService,
    PaymentIdempotencyService,
    PaymentPubSubIamProvisioningService,
    PaymentPubSubProvisioningService,
  ],
  exports: [
    PaymentsController,
    PaymentApiKeyService,
  ],
})
export class PaymentsModule {}
