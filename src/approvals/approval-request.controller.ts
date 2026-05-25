import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { ValidationError } from "../shared/errors";
import { AuthenticatedRequest } from "../types";
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
const STATUSES: ApprovalRequestStatus[] = ["pending", "approved", "rejected"];

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
  constructor(private readonly approvals: ApprovalRequestService) {}

  @Post()
  async create(
    @Body() body: CreateApprovalRequestBody,
    @Req() req: AuthenticatedRequest,
  ) {
    this.validateCreate(body);
    return this.response(
      await this.approvals.createRequest({
        actionType: body.actionType!,
        targetId: body.targetId ?? null,
        targetEnvironment: body.targetEnvironment!,
        before: body.before!,
        after: body.after!,
        riskLevel: body.riskLevel!,
        reason: body.reason!,
        requestedBy: this.resolveActor(req),
      }),
      req,
    );
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
    return this.response(
      await this.approvals.approveRequest(
        approvalRequestId,
        this.resolveActor(req),
      ),
      req,
    );
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

    return this.response(
      await this.approvals.rejectRequest(
        approvalRequestId,
        this.resolveActor(req),
        body.reason,
      ),
      req,
    );
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
