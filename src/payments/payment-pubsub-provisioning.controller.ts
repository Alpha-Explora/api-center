import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { PaymentPubSubProvisioningService } from "./payment-pubsub-provisioning.service";

@Controller("admin/payments/events")
@UseGuards(ScopedAdminGuard)
export class PaymentPubSubProvisioningController {
  constructor(private readonly provisioning: PaymentPubSubProvisioningService) {}

  @Post("consumers")
  async provisionConsumer(@Body() body: unknown) {
    return {
      success: true,
      data: await this.provisioning.provision(body),
    };
  }
}
