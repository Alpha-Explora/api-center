import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApprovalRequestService } from "@approvals/approval-request.service";
import { TribePlanService } from "@entitlements/tribe-plan.service";
import { TribeQuotaPolicyService } from "@quotas/tribe-quota-policy.service";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { RegistryService } from "@registry/registry.service";
import { ServiceLifecycleEvidenceService } from "./service-lifecycle-evidence.service";

@Controller("admin/operations/lifecycle")
@UseGuards(ScopedAdminGuard)
export class ServiceLifecycleEvidenceController {
  constructor(
    private readonly registry: RegistryService,
    private readonly quotaPolicies: TribeQuotaPolicyService,
    private readonly plans: TribePlanService,
    private readonly approvals: ApprovalRequestService,
    private readonly lifecycleEvidence: ServiceLifecycleEvidenceService,
  ) {}

  @Get()
  async getLifecycle() {
    const services = Object.values(this.registry.getAll());
    const [quotaPolicies, planAssignments, approvalRequests] =
      await Promise.all([
        this.quotaPolicies.listPolicies(),
        this.plans.listPlanAssignments({ status: "active" }),
        this.approvals.listRequests(),
      ]);

    return {
      success: true,
      data: this.lifecycleEvidence.build({
        services,
        quotaPolicies,
        planAssignments,
        approvalRequests,
        pipelineRows: [],
      }),
    };
  }
}
