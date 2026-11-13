import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../../../../types";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import {
  TENANCY_DIRECTORY,
  type TenancyDirectory,
} from "@registry/tenancy.types";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { z } from "zod";

const replay = z
  .object({
    environment: z.enum(["test", "live"]),
    eventId: z.string().uuid(),
    operationId: z.string().uuid(),
    actor: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
@Controller("admin/payments/events")
@UseGuards(ScopedAdminGuard)
export class PaymentEventRecoveryController {
  constructor(
    @Inject(TENANCY_DIRECTORY) private readonly tenancy: TenancyDirectory,
  ) {}
  @Get(":serviceId")
  async list(
    @Param("serviceId") serviceId: string,
    @Query("environment") environment: string,
  ) {
    if (environment !== "test" && environment !== "live")
      throw new BadRequestException("Environment must be test or live");
    return this.call(serviceId, environment, "GET");
  }
  @Post(":serviceId/replay")
  async replay(
    @Param("serviceId") serviceId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = replay.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException("Invalid event replay input");
    const { environment, ...input } = parsed.data;
    if (request.user?.sub) input.actor = request.user.sub;
    return this.call(serviceId, environment, "POST", input);
  }
  private async call(
    serviceId: string,
    environment: "test" | "live",
    method: "GET" | "POST",
    body?: Omit<z.infer<typeof replay>, "environment">,
  ) {
    const placement = this.tenancy.resolveServicePlacement(serviceId);
    if (!placement)
      throw new BadRequestException("Registered consumer service required");
    const baseUrl =
      environment === "live"
        ? process.env.SHARED_SERVICE_ROUTE_PAYMENT_LIVE
        : process.env.SHARED_SERVICE_ROUTE_PAYMENT_TEST;
    const token =
      (environment === "live"
        ? process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_LIVE
        : process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST) ||
      process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN;
    if (!baseUrl || !token)
      throw new ServiceUnavailableException(
        "Payment recovery runtime is not configured",
      );
    const cloudAuth = await getCloudRunAuthorizationHeader(baseUrl);
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/admin/payments/events${method === "POST" ? "/replay" : ""}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-APICenter-Owner-Tribe-ID": placement.tribeId,
          "X-APICenter-Project-ID": placement.projectId,
          "X-APICenter-Consumer-Service-ID": serviceId,
          "X-APICenter-Environment": environment,
          ...(cloudAuth ? { "X-Serverless-Authorization": cloudAuth } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const payload: unknown = await response.json();
    if (!response.ok)
      throw new BadRequestException({
        code: "PAYMENT_RECOVERY_FAILED",
        message: `Payment recovery failed (${response.status}); use the original operation ID when retrying`,
      });
    return payload;
  }
}
