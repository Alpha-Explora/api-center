import { Module } from "@nestjs/common";
import { ControlPlaneModule } from "@domains/control-plane/control-plane.module";
import { SharedServicesController } from "./shared-services.controller";
import { PaymentWebhookController } from "./payment-webhook.controller";
import { DeliveryWebhookController } from "./delivery-webhook.controller";
import { SharedServiceRoutingService } from "./shared-service-routing.service";
import { ApplicationCapabilityProxy } from "./application-capability-proxy";

/**
 * Capability calls with application keys, and provider callbacks (PayMongo, Resend, Twilio).
 * The provider callbacks are listed first: Express matches routes in registration order, and
 * SharedServicesController's `shared/:capability/*path` would otherwise take
 * `shared/payment/webhooks/:environment` and reject PayMongo for having no application key.
 */
@Module({
  imports: [ControlPlaneModule],
  controllers: [PaymentWebhookController, DeliveryWebhookController, SharedServicesController],
  providers: [SharedServiceRoutingService, ApplicationCapabilityProxy],
})
export class SharedServicesModule {}
