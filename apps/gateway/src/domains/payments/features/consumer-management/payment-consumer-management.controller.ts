import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { PaymentConsumerManagementService } from "./payment-consumer-management.service";

@Controller("admin/payments/consumers")
@UseGuards(ScopedAdminGuard)
export class PaymentConsumerManagementController {
  constructor(private readonly consumers: PaymentConsumerManagementService) {}

  @Get()
  async list(@Query("organizationId") organizationFilter?: string) {
    let organizationIds: string[] | undefined;
    if (organizationFilter !== undefined) {
      organizationIds = organizationFilter.split(",").map((id) => id.trim()).filter(Boolean);
      if (organizationIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
        throw new BadRequestException("organizationId must contain UUID values");
      }
    }
    return { success: true, data: await this.consumers.list(organizationIds) };
  }

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
