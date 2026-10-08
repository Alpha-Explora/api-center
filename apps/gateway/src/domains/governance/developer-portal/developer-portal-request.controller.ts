import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { ApprovalRequestService } from "@approvals/approval-request.service";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { ForbiddenError } from "@shared/errors";

@Controller("developer-portal/requests")
@UseGuards(JwtAuthGuard)
export class DeveloperPortalRequestController {
  constructor(private readonly approvals: ApprovalRequestService) {}

  @Post("quota-increase")
  async requestQuotaIncrease(
    @Body()
    input: {
      ownerTribeId?: string;
      projectId?: string;
      requestedMaxRequests: number;
      reason: string;
    },
    @Req() req: any,
  ) {
    const authenticatedTribeId = req.user?.tribeId ?? req.tribeId;
    if (!authenticatedTribeId) {
      throw new ForbiddenError(
        "Quota increase requests require a tribe token.",
      );
    }
    if (input.ownerTribeId && input.ownerTribeId !== authenticatedTribeId) {
      throw new ForbiddenError(
        "Tribes can only request quota changes for their own tribe.",
      );
    }
    // A service token carries its project, so the request targets that project's budget. Without one the
    // request is for the tribe-wide ceiling.
    const authenticatedProjectId: string | undefined = req.projectId ?? req.user?.projectId;
    if (input.projectId && input.projectId !== authenticatedProjectId) {
      throw new ForbiddenError(
        "Services can only request quota changes for their own project.",
      );
    }
    const projectId = input.projectId ?? authenticatedProjectId;

    const request = await this.approvals.createRequest({
      actionType: "quota.increase",
      targetEnvironment: "live",
      targetId: projectId ?? authenticatedTribeId,
      requestedBy: authenticatedTribeId,
      reason: input.reason,
      riskLevel: "medium",
      before: {
        ownerTribeId: authenticatedTribeId,
        ...(projectId ? { projectId } : {}),
      },
      after: {
        ownerTribeId: authenticatedTribeId,
        ...(projectId ? { projectId } : {}),
        requestedMaxRequests: input.requestedMaxRequests,
      },
    });

    return { success: true, data: request };
  }
}
