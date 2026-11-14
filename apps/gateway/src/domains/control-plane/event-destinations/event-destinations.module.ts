import { Module } from "@nestjs/common";
import { DatabaseModule } from "@database/database.module";
import { PaymentPubSubProvisioningService } from "@payments/features/pubsub-provisioning/payment-pubsub-provisioning.service";
import { PaymentPubSubIamProvisioningService } from "@payments/features/pubsub-provisioning/payment-pubsub-iam-provisioning.service";
import { ControlPlaneModule } from "../control-plane.module";
import { EventDestinationsController } from "./event-destinations.controller";
import { EventDestinationService } from "./event-destination.service";

/** Per-environment event destinations for control-plane applications. */
@Module({
  imports: [DatabaseModule, ControlPlaneModule],
  controllers: [EventDestinationsController],
  providers: [EventDestinationService, PaymentPubSubProvisioningService, PaymentPubSubIamProvisioningService],
})
export class EventDestinationsModule {}
