import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { ApprovalRequestService } from "../approvals/approval-request.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

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
    const request = await this.approvals.createRequest({
      actionType: "quota.increase",
      targetEnvironment: "live",
      targetId: input.ownerTribeId,
      requestedBy: req.user?.tribeId ?? input.ownerTribeId,
      reason: input.reason,
      riskLevel: "medium",
      before: {
        ownerTribeId: input.ownerTribeId,
      },
      after: {
        ownerTribeId: input.ownerTribeId,
        requestedMaxRequests: input.requestedMaxRequests,
      },
    });

    return { success: true, data: request };
  }
}
