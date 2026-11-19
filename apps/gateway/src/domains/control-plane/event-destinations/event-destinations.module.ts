import { Module } from "@nestjs/common";
import { DatabaseModule } from "@database/database.module";
import { PaymentPubSubProvisioningService } from "@payments/features/pubsub-provisioning/payment-pubsub-provisioning.service";
import { PaymentPubSubIamProvisioningService } from "@payments/features/pubsub-provisioning/payment-pubsub-iam-provisioning.service";
import { ControlPlaneModule } from "../control-plane.module";
import { EventDestinationsController } from "./event-destinations.controller";
import { EventDestinationService } from "./event-destination.service";
import { createMemoryWebhookConfigStore, createSecretManagerWebhookConfigStore, WEBHOOK_CONFIG_STORE } from "./webhook-config-store";

/** Per-environment event destinations for control-plane applications. */
@Module({
  imports: [DatabaseModule, ControlPlaneModule],
  controllers: [EventDestinationsController],
  providers: [
    EventDestinationService,
    PaymentPubSubProvisioningService,
    PaymentPubSubIamProvisioningService,
    {
      // Webhook URLs and signing secrets live in Secret Manager; local runs keep them in memory.
      provide: WEBHOOK_CONFIG_STORE,
      useFactory: () =>
        process.env.GCP_PROJECT_ID ? createSecretManagerWebhookConfigStore(process.env.GCP_PROJECT_ID) : createMemoryWebhookConfigStore(),
    },
  ],
})
export class EventDestinationsModule {}
