import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { PaymentConsumerManagementService } from "./payment-consumer-management.service";

@Controller("admin/payments/consumers")
@UseGuards(ScopedAdminGuard)
export class PaymentConsumerManagementController {
  constructor(private readonly consumers: PaymentConsumerManagementService) {}

  @Post()
  async register(@Body() body: unknown) {
    return {
      success: true,
      data: await this.consumers.register(body),
    };
  }

  @Post(":consumerServiceId/keys/rotate")
  async rotate(@Param("consumerServiceId") consumerServiceId: string, @Body() body: Record<string, unknown>) {
    return {
      success: true,
      data: await this.consumers.rotate({
        ...body,
        consumerServiceId,
      }),
    };
  }

  @Post(":consumerServiceId/keys/revoke")
  async revoke(@Param("consumerServiceId") consumerServiceId: string, @Body() body: Record<string, unknown>) {
    return {
      success: true,
      data: await this.consumers.revoke({
        ...body,
        consumerServiceId,
      }),
    };
  }
}

