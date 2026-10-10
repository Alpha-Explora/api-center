import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@shared/errors";
import {
  ApprovalCheckInput,
  ApprovalRequest,
  ApprovalRequestStatus,
  CreateApprovalRequestInput,
} from "./approval-request.types";

interface ApprovalRequestDelegate {
  create(args: { data: Record<string, unknown> }): Promise<ApprovalRequest>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy: { createdAt: "desc" };
    take: number;
  }): Promise<ApprovalRequest[]>;
  findUnique(args: { where: { id: string } }): Promise<ApprovalRequest | null>;
  updateMany(args: {
    where: { id: string; status: ApprovalRequestStatus };
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

interface ApprovalPrisma {
  approvalRequest: ApprovalRequestDelegate;
}

@Injectable()
export class ApprovalRequestService {
  private readonly approvalPrisma: ApprovalPrisma;

  constructor(prisma: PrismaService) {
    this.approvalPrisma = prisma as unknown as ApprovalPrisma;
  }

  async createRequest(
    input: CreateApprovalRequestInput,
  ): Promise<ApprovalRequest> {
    this.validateCreate(input);
    return this.approvalPrisma.approvalRequest.create({
      data: {
        ...input,
        targetId: input.targetId ?? null,
        status: "pending",
      },
    });
  }

  async listRequests(status?: string): Promise<ApprovalRequest[]> {
    return this.approvalPrisma.approvalRequest.findMany({
      where: {
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async approveRequest(
    approvalRequestId: string,
    approvedBy: string,
  ): Promise<ApprovalRequest> {
    const request = await this.getRequired(approvalRequestId);
    this.assertStatus(request, "pending");
    if (request.requestedBy === approvedBy) {
      throw new ForbiddenError(
        "Requesters cannot approve their own approval request",
      );
    }
    return this.transition(approvalRequestId, "pending", {
      status: "approved",
      approvedBy,
      approvedAt: new Date(),
    });
  }

  async rejectRequest(
    approvalRequestId: string,
    rejectedBy: string,
    rejectionReason: string,
  ): Promise<ApprovalRequest> {
    return this.transition(approvalRequestId, "pending", {
      status: "rejected",
      rejectedBy,
      rejectedAt: new Date(),
      rejectionReason,
    });
  }

  async cancelRequest(
    approvalRequestId: string,
    cancelledBy: string,
    options: { isAdmin: boolean },
  ): Promise<ApprovalRequest> {
    const request = await this.getRequired(approvalRequestId);
    if (!options.isAdmin && request.requestedBy !== cancelledBy) {
      throw new ForbiddenError(
        "Only the requester or an admin can cancel an approval request",
      );
    }
    this.assertStatus(request, "pending");
    return this.transition(approvalRequestId, "pending", {
      status: "cancelled",
      cancelledBy,
      cancelledAt: new Date(),
    });
  }

  async assertApprovedForAction(
    input: ApprovalCheckInput,
  ): Promise<ApprovalRequest | null> {
    if (input.targetEnvironment !== "live") return null;
    if (!input.approvalRequestId) {
      throw new ForbiddenError(
        `${input.actionType} in live requires an approved request`,
      );
    }

    const request = await this.getRequired(input.approvalRequestId);
    if (request.status === "applied") {
      throw new ConflictError("Approval request has already been applied");
    }
    if (request.status !== "approved") {
      throw new ForbiddenError("Approval request is not approved");
    }
    if (request.actionType !== input.actionType) {
      throw new ForbiddenError("Approval request action type does not match");
    }
    if (request.targetEnvironment !== input.targetEnvironment) {
      throw new ForbiddenError("Approval request environment does not match");
    }
    if (input.requireTarget && (!input.targetId || request.targetId !== input.targetId)) {
      throw new ForbiddenError("Approval request target does not match");
    }
    if (
      !input.requireTarget &&
      input.targetId &&
      request.targetId &&
      request.targetId !== input.targetId
    ) {
      throw new ForbiddenError("Approval request target does not match");
    }

    return this.transition(input.approvalRequestId, "approved", {
      status: "applied",
      appliedAt: new Date(),
    });
  }

  private assertStatus(
    request: ApprovalRequest,
    expected: ApprovalRequestStatus,
  ): void {
    if (request.status !== expected) {
      throw new ConflictError(
        `Approval request is ${request.status}, not ${expected}`,
      );
    }
  }

  /**
   * Moves a request out of `fromStatus` in one conditional update. If another
   * request already moved it, the update matches nothing and the caller gets a 409.
   */
  private async transition(
    approvalRequestId: string,
    fromStatus: ApprovalRequestStatus,
    data: Record<string, unknown>,
  ): Promise<ApprovalRequest> {
    const result = await this.approvalPrisma.approvalRequest.updateMany({
      where: { id: approvalRequestId, status: fromStatus },
      data,
    });
    if (result.count === 0) {
      const current = await this.getRequired(approvalRequestId);
      throw new ConflictError(
        `Approval request is ${current.status}, not ${fromStatus}`,
      );
    }
    return this.getRequired(approvalRequestId);
  }

  private async getRequired(approvalRequestId: string) {
    const request = await this.approvalPrisma.approvalRequest.findUnique({
      where: { id: approvalRequestId },
    });
    if (!request) {
      throw new NotFoundError(
        `Approval request '${approvalRequestId}' not found`,
      );
    }
    return request;
  }

  private validateCreate(input: CreateApprovalRequestInput): void {
    if (!input.before || !input.after) {
      throw new ValidationError(
        "before and after preview payloads are required",
      );
    }
    if (!input.reason?.trim()) {
      throw new ValidationError("reason is required");
    }
    if (!input.requestedBy?.trim()) {
      throw new ValidationError("requestedBy is required");
    }
    if (!input.targetEnvironment?.trim()) {
      throw new ValidationError("targetEnvironment is required");
    }
  }
}
