import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  Optional,
} from "@nestjs/common";
import { AuditEventsService } from "@audit/audit-events.service";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { ValidationError } from "@shared/errors";
import { requireGovernanceDependency } from "@shared/governance-dependencies";
import { AuthenticatedRequest } from "../../../types";
import { ApprovalRequestService } from "./approval-request.service";
import {
  ApprovalActionType,
  ApprovalRequest,
  ApprovalRequestStatus,
  ApprovalRiskLevel,
} from "./approval-request.types";

const ACTION_TYPES: ApprovalActionType[] = [
  "quota.enforce",
  "secret.rotate",
  "topic.provision",
  "s3_sink.include_topic",
  "service.register_live",
  "service.retire",
  "plan.assign_live",
];
const RISK_LEVELS: ApprovalRiskLevel[] = ["low", "medium", "high", "critical"];
const STATUSES: ApprovalRequestStatus[] = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "applied",
];

interface CreateApprovalRequestBody {
  actionType?: ApprovalActionType;
  targetId?: string | null;
  targetEnvironment?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  riskLevel?: ApprovalRiskLevel;
  reason?: string;
}

@Controller("approvals/requests")
@UseGuards(ScopedAdminGuard)
export class ApprovalRequestController {
  constructor(
    private readonly approvals: ApprovalRequestService,
    @Optional() private readonly auditEvents?: AuditEventsService,
  ) {}

  @Post()
  async create(
    @Body() body: CreateApprovalRequestBody,
    @Req() req: AuthenticatedRequest,
  ) {
    this.validateCreate(body);
    const request = await this.approvals.createRequest({
      actionType: body.actionType!,
      targetId: body.targetId ?? null,
      targetEnvironment: body.targetEnvironment!,
      before: body.before!,
      after: body.after!,
      riskLevel: body.riskLevel!,
      reason: body.reason!,
      requestedBy: this.resolveActor(req),
    });
    await this.recordAudit("approval.request.created", request, req);
    return this.response(request, req);
  }

  @Get()
  async list(@Query("status") status: ApprovalRequestStatus | undefined) {
    if (status && !STATUSES.includes(status)) {
      throw new ValidationError("status is invalid");
    }
    const requests = await this.approvals.listRequests(status);
    return this.response(requests, undefined, { total: requests.length });
  }

  @Post(":approvalRequestId/approve")
  async approve(
    @Param("approvalRequestId") approvalRequestId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const request = await this.approvals.approveRequest(
      approvalRequestId,
      this.resolveActor(req),
    );
    await this.recordAudit("approval.request.approved", request, req);
    return this.response(request, req);
  }

  @Post(":approvalRequestId/reject")
  async reject(
    @Param("approvalRequestId") approvalRequestId: string,
    @Body() body: { reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!body.reason?.trim()) {
      throw new ValidationError("rejection reason is required");
    }

    const request = await this.approvals.rejectRequest(
      approvalRequestId,
      this.resolveActor(req),
      body.reason,
    );
    await this.recordAudit("approval.request.rejected", request, req, {
      rejectionReason: body.reason,
    });
    return this.response(request, req);
  }

  @Post(":approvalRequestId/cancel")
  async cancel(
    @Param("approvalRequestId") approvalRequestId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const request = await this.approvals.cancelRequest(
      approvalRequestId,
      this.resolveActor(req),
      { isAdmin: true },
    );
    await this.recordAudit("approval.request.cancelled", request, req);
    return this.response(request, req);
  }

  private async recordAudit(
    type: string,
    request: ApprovalRequest,
    req: AuthenticatedRequest,
    extraPayload: Record<string, unknown> = {},
  ): Promise<void> {
    const auditEvents = requireGovernanceDependency(
      this.auditEvents,
      "AuditEventsService",
    );
    await auditEvents.recordRequired({
      type,
      actionFamily: "approval",
      actor: this.resolveActor(req),
      resourceType: "approval_request",
      resourceId: request.id,
      environment: request.targetEnvironment,
      correlationId: req.correlationId ?? request.id,
      severity: request.status === "rejected" ? "warning" : "info",
      message: `${type} for ${request.actionType}`,
      payload: {
        approvalRequestId: request.id,
        actionType: request.actionType,
        targetId: request.targetId,
        targetEnvironment: request.targetEnvironment,
        status: request.status,
        correlationId: req.correlationId,
        ...extraPayload,
      },
    });
  }

  private validateCreate(body: CreateApprovalRequestBody) {
    if (!body.actionType || !ACTION_TYPES.includes(body.actionType)) {
      throw new ValidationError("actionType is invalid");
    }
    if (!body.riskLevel || !RISK_LEVELS.includes(body.riskLevel)) {
      throw new ValidationError("riskLevel is invalid");
    }
    if (!body.targetEnvironment?.trim()) {
      throw new ValidationError("targetEnvironment is required");
    }
    if (!body.before || !body.after) {
      throw new ValidationError("before and after are required");
    }
    if (!body.reason?.trim()) {
      throw new ValidationError("reason is required");
    }
  }

  private resolveActor(req: AuthenticatedRequest) {
    return (
      req.user?.tribeId ?? req.tribeId ?? req.user?.sub ?? "platform-admin"
    );
  }

  private response(
    data: ApprovalRequest | ApprovalRequest[],
    req?: AuthenticatedRequest,
    meta: Record<string, unknown> = {},
  ) {
    return {
      success: true,
      data,
      meta: {
        ...meta,
        timestamp: new Date().toISOString(),
        correlationId: req?.correlationId,
      },
    };
  }
}
