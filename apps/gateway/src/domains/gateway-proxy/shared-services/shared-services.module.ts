import { Module } from "@nestjs/common";
import { ControlPlaneModule } from "@domains/control-plane/control-plane.module";
import { SharedServicesController } from "./shared-services.controller";
import { PaymentWebhookController } from "./payment-webhook.controller";
import { DeliveryWebhookController } from "./delivery-webhook.controller";
import { SharedServiceRoutingService } from "./shared-service-routing.service";
import { ApplicationCapabilityProxy } from "./application-capability-proxy";

/** Capability calls with application keys, and provider callbacks (PayMongo, Resend, Twilio). */
@Module({
  imports: [ControlPlaneModule],
  controllers: [SharedServicesController, PaymentWebhookController, DeliveryWebhookController],
  providers: [SharedServiceRoutingService, ApplicationCapabilityProxy],
})
export class SharedServicesModule {}
