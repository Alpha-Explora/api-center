// GET admin/control-plane/organizations/:organizationId/payments/merchant-binding: whether the
// organization is bound to the APICenter payments merchant (PAYMENTS_MERCHANT_ORGANIZATION_IDS), so
// the console can explain why enabling payments is refused instead of surfacing a bare 403.

import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ValidationError } from "@shared/errors";
import { ConsoleAccessService } from "./console-access.service";
import { ConsoleActorGuard, type ConsoleRequest } from "./console-actor.guard";
import { merchantBindingStatus } from "./merchant-binding";

const organizationId = z.string().uuid();

@Controller("admin/control-plane/organizations/:organizationId/payments")
@UseGuards(ConsoleActorGuard)
export class PaymentsMerchantController {
  constructor(private readonly access: ConsoleAccessService) {}

  @Get("merchant-binding")
  async merchantBinding(@Param("organizationId") rawOrganizationId: string, @Req() req: ConsoleRequest) {
    const parsed = organizationId.safeParse(rawOrganizationId);
    if (!parsed.success) throw new ValidationError("organizationId must be a UUID");
    if (!req.consoleActor) throw new ValidationError("Console actor is missing");
    await this.access.require(req.consoleActor, parsed.data, "organization.read");
    return { success: true, data: merchantBindingStatus(parsed.data) };
  }
}
