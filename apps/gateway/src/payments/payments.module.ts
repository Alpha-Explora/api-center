import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { PaymentsController } from "./payments.controller";
import { PaymentApiKeyService } from "./payment-api-key.service";
import { PaymentAuthGuard } from "./payment-auth.guard";
import { PaymentCatalogManagementController } from "./payment-catalog-management.controller";
import { PaymentCatalogManagementService } from "./payment-catalog-management.service";
import { PaymentConsumerManagementController } from "./payment-consumer-management.controller";
import { PaymentConsumerManagementService } from "./payment-consumer-management.service";
import { PaymentIdempotencyService } from "./payment-idempotency.service";
import { PaymentPubSubIamProvisioningService } from "./payment-pubsub-iam-provisioning.service";
import { PaymentPubSubProvisioningController } from "./payment-pubsub-provisioning.controller";
import { PaymentPubSubProvisioningService } from "./payment-pubsub-provisioning.service";

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
})
export class PaymentsModule {}