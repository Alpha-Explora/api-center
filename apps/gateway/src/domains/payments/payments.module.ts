import { Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { DatabaseModule } from "@database/database.module";
import { RegistryModule } from "@registry/registry.module";
import { PaymentsController, PaymentApiKeyService } from "./features/payment-facade";
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
import { ApprovalsModule } from "@approvals/approvals.module";
import { PaymentLimitsAdminController, PaymentLimitsService } from "./features/payment-limits";
import { PAYMENT_CONSUMER_REGISTRATION_DIRECTORY } from "./features/consumer-management/payment-consumer.types";

@Module({
  imports: [AuthModule, ApprovalsModule, DatabaseModule, RegistryModule],
  controllers: [
    PaymentsController,
    PaymentConsumerManagementController,
    PaymentPubSubProvisioningController,
    PaymentRecordsManagementController,
    PaymentLimitsAdminController,
  ],
  providers: [
    PaymentApiKeyService,
    PaymentAuthGuard,
    PaymentConsumerManagementService,
    { provide: PAYMENT_CONSUMER_REGISTRATION_DIRECTORY, useExisting: PaymentConsumerManagementService },
    PaymentIdempotencyService,
    PaymentPubSubIamProvisioningService,
    PaymentPubSubProvisioningService,
    PaymentRecordsManagementService,
    PaymentLimitsService,
  ],
  exports: [
    PaymentApiKeyService,
    PaymentConsumerManagementService,
    PAYMENT_CONSUMER_REGISTRATION_DIRECTORY,
  ],
})
export class PaymentsModule {}
