import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { ApprovalRequestService } from "../approvals/approval-request.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ForbiddenError } from "../shared/errors";

@Controller("developer-portal/requests")
@UseGuards(JwtAuthGuard)
export class DeveloperPortalRequestController {
  constructor(private readonly approvals: ApprovalRequestService) {}

  @Post("quota-increase")
  async requestQuotaIncrease(
    @Body()
    input: {
      ownerTribeId: string;
      requestedMaxRequests: number;
      reason: string;
    },
    @Req() req: any,
  ) {
    const authenticatedTribeId = req.user?.tribeId ?? req.tribeId;
    if (!authenticatedTribeId) {
      throw new ForbiddenError("Quota increase requests require a tribe token.");
    }
    if (input.ownerTribeId && input.ownerTribeId !== authenticatedTribeId) {
      throw new ForbiddenError(
        "Tribes can only request quota changes for their own tribe.",
      );
    }

    const request = await this.approvals.createRequest({
      actionType: "quota.increase",
      targetEnvironment: "live",
      targetId: authenticatedTribeId,
      requestedBy: authenticatedTribeId,
      reason: input.reason,
      riskLevel: "medium",
      before: {
        ownerTribeId: authenticatedTribeId,
      },
      after: {
        ownerTribeId: authenticatedTribeId,
        requestedMaxRequests: input.requestedMaxRequests,
      },
    });

    return { success: true, data: request };
  }
}
