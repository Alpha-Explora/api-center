import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { AuditEventsService } from "@audit/audit-events.service";
import { TENANCY_DIRECTORY, type TenancyDirectory } from "@registry/tenancy.types";
import { AuthenticatedRequest } from "../../../../types";
import { PaymentLimitsService, type PaymentEnvironment } from "./payment-limits.service";

@Controller("admin/payments/limits")
@UseGuards(ScopedAdminGuard)
export class PaymentLimitsAdminController {
  constructor(
    private readonly limits: PaymentLimitsService,
    @Inject(TENANCY_DIRECTORY) private readonly tenancy: TenancyDirectory,
    @Optional() private readonly auditEvents?: AuditEventsService,
  ) {}

  @Get()
  async get(
    @Query("projectId") projectId: string,
    @Query("environment") environment: string,
  ) {
    const target = this.validateTarget(projectId, environment);
    const placement = this.tenancy.resolveProject(target.projectId);
    if (!placement) throw new BadRequestException("Project is not registered");
    return {
      success: true,
      data: await this.limits.resolve(placement.tribe.tribeId, target.projectId, target.environment),
    };
  }

  @Post()
  async set(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    const target = this.validateTarget(body.projectId, body.environment);
    if (!Number.isSafeInteger(body.maximumPaymentAmountMinor) || Number(body.maximumPaymentAmountMinor) <= 0) {
      throw new BadRequestException("maximumPaymentAmountMinor must be a positive safe integer");
    }
    if (!Number.isSafeInteger(body.paymentRequestsPerMinute) || Number(body.paymentRequestsPerMinute) <= 0) {
      throw new BadRequestException("paymentRequestsPerMinute must be a positive safe integer");
    }
    if (typeof body.reason !== "string" || !body.reason.trim()) {
      throw new BadRequestException("reason is required");
    }
    const placement = this.tenancy.resolveProject(target.projectId);
    if (!placement) throw new BadRequestException("Project is not registered");
    const actor = req.user?.sub ?? req.tribeId ?? "platform";
    const values = {
      maximumPaymentAmountMinor: Number(body.maximumPaymentAmountMinor),
      paymentRequestsPerMinute: Number(body.paymentRequestsPerMinute),
    };
    await this.limits.setOverride({
      ownerTribeId: placement.tribe.tribeId,
      projectId: target.projectId,
      environment: target.environment,
      ...values,
      reason: body.reason.trim(),
      updatedBy: actor,
    });
    await this.recordAudit("payment.limits.overridden", target, placement.tribe.tribeId, actor, req, {
      ...values,
      reason: body.reason.trim(),
    });
    return {
      success: true,
      data: await this.limits.resolve(placement.tribe.tribeId, target.projectId, target.environment),
    };
  }

  @Delete(":projectId/:environment")
  async clear(
    @Param("projectId") projectId: string,
    @Param("environment") environment: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const target = this.validateTarget(projectId, environment);
    const placement = this.tenancy.resolveProject(target.projectId);
    if (!placement) throw new BadRequestException("Project is not registered");
    const removed = await this.limits.clearOverride(target.projectId, target.environment);
    if (removed) {
      await this.recordAudit("payment.limits.reset", target, placement.tribe.tribeId,
        req.user?.sub ?? req.tribeId ?? "platform", req, {});
    }
    return {
      success: true,
      data: await this.limits.resolve(placement.tribe.tribeId, target.projectId, target.environment),
    };
  }

  private validateTarget(projectId: unknown, environment: unknown): {
    projectId: string;
    environment: PaymentEnvironment;
  } {
    if (typeof projectId !== "string" || !projectId.trim()) {
      throw new BadRequestException("projectId is required");
    }
    if (environment !== "test" && environment !== "live") {
      throw new BadRequestException("environment must be test or live");
    }
    return { projectId: projectId.trim(), environment };
  }

  private async recordAudit(
    type: string,
    target: { projectId: string; environment: PaymentEnvironment },
    ownerTribeId: string,
    actor: string,
    req: AuthenticatedRequest,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditEvents) throw new Error("AuditEventsService is unavailable");
    await this.auditEvents.recordRequired({
      type,
      actionFamily: "gateway",
      actor,
      resourceType: "payment_limit_override",
      resourceId: `${target.projectId}:${target.environment}`,
      environment: target.environment,
      correlationId: req.correlationId ?? `${target.projectId}:${target.environment}`,
      severity: "info",
      message: `Payment limits updated for project ${target.projectId}`,
      payload: { ownerTribeId, projectId: target.projectId, environment: target.environment, ...payload },
    });
  }
}
