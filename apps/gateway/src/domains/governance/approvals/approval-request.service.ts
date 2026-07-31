import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@shared/errors";
import {
  ApprovalCheckInput,
  ApprovalRequest,
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
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<ApprovalRequest>;
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
    await this.getRequired(approvalRequestId);
    return this.approvalPrisma.approvalRequest.update({
      where: { id: approvalRequestId },
      data: {
        status: "approved",
        approvedBy,
        approvedAt: new Date(),
      },
    });
  }

  async rejectRequest(
    approvalRequestId: string,
    rejectedBy: string,
    rejectionReason: string,
  ): Promise<ApprovalRequest> {
    await this.getRequired(approvalRequestId);
    return this.approvalPrisma.approvalRequest.update({
      where: { id: approvalRequestId },
      data: {
        status: "rejected",
        rejectedBy,
        rejectedAt: new Date(),
        rejectionReason,
      },
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
    if (request.status !== "approved") {
      throw new ForbiddenError("Approval request is not approved");
    }
    if (request.actionType !== input.actionType) {
      throw new ForbiddenError("Approval request action type does not match");
    }
    if (request.targetEnvironment !== input.targetEnvironment) {
      throw new ForbiddenError("Approval request environment does not match");
    }
    if (
      input.targetId &&
      request.targetId &&
      request.targetId !== input.targetId
    ) {
      throw new ForbiddenError("Approval request target does not match");
    }

    return request;
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
