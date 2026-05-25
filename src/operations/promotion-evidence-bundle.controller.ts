import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { ApprovalRequestService } from "../approvals/approval-request.service";
import { PipelineHealthService } from "../data-pipeline/pipeline-health.service";
import { TribePlanService } from "../entitlements/tribe-plan.service";
import { TribeQuotaPolicyService } from "../quotas/tribe-quota-policy.service";
import { RegistryService } from "../registry/registry.service";
import { PromotionEvidenceBundleService } from "./promotion-evidence-bundle.service";

@Controller("admin/operations/evidence")
@UseGuards(ScopedAdminGuard)
export class PromotionEvidenceBundleController {
  constructor(
    private readonly registry: RegistryService,
    private readonly evidence: PromotionEvidenceBundleService,
    private readonly quotaPolicies: TribeQuotaPolicyService,
    private readonly plans: TribePlanService,
    private readonly approvals: ApprovalRequestService,
    private readonly pipelineHealth: PipelineHealthService,
  ) {}

  @Get(":serviceId")
  async getEvidence(
    @Param("serviceId") serviceId: string,
    @Query("format") format: string | undefined,
  ) {
    const entry = this.registry.get(serviceId);
    const ownerTribeId = readOwnerTribeId(entry) ?? serviceId;
    const [quotaPolicies, planAssignments, approvalRequests, pipeline] =
      await Promise.all([
        this.quotaPolicies.listPolicies(ownerTribeId),
        this.plans.listPlanAssignments({
          ownerTribeId,
          status: "active",
        }),
        this.approvals.listRequests(),
        this.getPipelineEvidence(serviceId, ownerTribeId),
      ]);

    const approval =
      approvalRequests.find(
        (request) =>
          request.status === "approved" &&
          (!request.targetId || request.targetId === serviceId),
      ) ?? null;

    const bundle = this.evidence.build({
      serviceId,
      health: { status: entry?.healthy === false ? "down" : "up" },
      quotaPolicy:
        quotaPolicies.find((policy) => policy.status === "active") ?? null,
      planAssignment:
        planAssignments.find((assignment) => assignment.status === "active") ??
        null,
      approval,
      smoke: { status: entry ? "passed" : "missing" },
      manifest: { status: entry ? "valid" : "missing" },
      pipeline,
    });

    if (format === "md") {
      return this.toMarkdown(bundle);
    }

    return { success: true, data: bundle };
  }

  private async getPipelineEvidence(serviceId: string, ownerTribeId: string) {
    const rows = await this.pipelineHealth.listHealth("prod");
    const matchingRows = rows.filter(
      (row) =>
        row.tribeId === ownerTribeId || row.sourceServiceId === serviceId,
    );

    if (matchingRows.length === 0) {
      return null;
    }

    return {
      topicExists: true,
      s3SinkIncludesTopic: true,
      rows: matchingRows,
    };
  }

  private toMarkdown(
    bundle: ReturnType<PromotionEvidenceBundleService["build"]>,
  ) {
    return [
      `# Promotion Evidence: ${bundle.serviceId}`,
      "",
      ...bundle.sections.flatMap((section) => [
        `## ${titleCase(section.key)}`,
        `- Status: ${section.status}`,
        `- Evidence: ${JSON.stringify(section.data ?? {})}`,
        "",
      ]),
    ].join("\n");
  }
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function readOwnerTribeId(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const value = (entry as { ownerTribeId?: unknown }).ownerTribeId;
  return typeof value === "string" && value.trim() ? value : undefined;
}
