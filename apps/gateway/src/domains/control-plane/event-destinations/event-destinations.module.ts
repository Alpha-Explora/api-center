import { Module } from "@nestjs/common";
import { DatabaseModule } from "@database/database.module";
import { PaymentPubSubProvisioningService } from "@payments/features/pubsub-provisioning/payment-pubsub-provisioning.service";
import { ControlPlaneModule } from "../control-plane.module";
import { EventDestinationsController } from "./event-destinations.controller";
import { EventDestinationService } from "./event-destination.service";
import { WebhookDeliveriesController } from "./webhook-deliveries.controller";
import { WebhookDeliveriesService } from "./webhook-deliveries.service";
import { createRuntimeDeliveryHistory, WEBHOOK_DELIVERY_HISTORY } from "./webhook-delivery-history";
import { createPubSubTestEventPublisher, WEBHOOK_TEST_EVENT_PUBLISHER } from "./webhook-test-event";
import { ServiceUnavailableError } from "@shared/errors";
import { createMemoryWebhookConfigStore, createSecretManagerWebhookConfigStore, WEBHOOK_CONFIG_STORE } from "./webhook-config-store";

/** Per-environment event destinations for control-plane applications. */
@Module({
  imports: [DatabaseModule, ControlPlaneModule],
  controllers: [EventDestinationsController, WebhookDeliveriesController],
  providers: [
    EventDestinationService,
    WebhookDeliveriesService,
    PaymentPubSubProvisioningService,
    {
      // Webhook URLs and signing secrets live in Secret Manager; local runs keep them in memory.
      provide: WEBHOOK_CONFIG_STORE,
      useFactory: () =>
        process.env.GCP_PROJECT_ID ? createSecretManagerWebhookConfigStore(process.env.GCP_PROJECT_ID) : createMemoryWebhookConfigStore(),
    },
    // Delivery history is owned by the webhooks runtime and read through its admin route.
    { provide: WEBHOOK_DELIVERY_HISTORY, useFactory: () => createRuntimeDeliveryHistory() },
    {
      // Test events go onto the real payment events topic; without a GCP project there is nowhere to publish.
      provide: WEBHOOK_TEST_EVENT_PUBLISHER,
      useFactory: () =>
        process.env.GCP_PROJECT_ID
          ? createPubSubTestEventPublisher(process.env.GCP_PROJECT_ID)
          : {
              publish: async () => {
                throw new ServiceUnavailableError("Pub/Sub is not configured (GCP_PROJECT_ID)");
              },
            },
    },
  ],
})
export class EventDestinationsModule {}
