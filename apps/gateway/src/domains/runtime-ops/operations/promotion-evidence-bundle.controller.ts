import { Controller, Get, Optional, Param, Query, UseGuards } from "@nestjs/common";
import { AuditEventsService } from "@audit/audit-events.service";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { ManagementSourceMetadata } from "@shared/source-metadata";
import { ApprovalRequestService } from "@approvals/approval-request.service";
import { TribePlanService } from "@entitlements/tribe-plan.service";
import { TribeQuotaPolicyService } from "@quotas/tribe-quota-policy.service";
import { RegistryService } from "@registry/registry.service";
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
    @Optional() private readonly auditEvents?: AuditEventsService,
  ) {}

  @Get(":serviceId")
  async getEvidence(
    @Param("serviceId") serviceId: string,
    @Query("format") format: string | undefined,
  ) {
    const entry = this.registry.get(serviceId);
    const ownerTribeId = readOwnerTribeId(entry);
    const projectId = entry?.projectId;
    const [quotaPolicies, planAssignments, approvalRequests] =
      await Promise.all([
        ownerTribeId
          ? this.quotaPolicies.listPoliciesForPortal(ownerTribeId, projectId)
          : Promise.resolve([]),
        projectId
          ? this.plans.listPlanAssignments({ projectId, status: "active" })
          : Promise.resolve([]),
        this.approvals.listRequests(),
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
      pipeline: null,
    });

    const sourceMetadata = [
      this.evidence.getSourceMetadata(),
    ];
    this.recordPromotionEvidenceAudit(bundle, sourceMetadata);

    if (format === "md") {
      return this.toMarkdown(bundle);
    }

    return {
      success: true,
      data: bundle,
      meta: {
        sourceMetadata,
      },
    };
  }

  private recordPromotionEvidenceAudit(
    bundle: ReturnType<PromotionEvidenceBundleService["build"]>,
    sourceMetadata: ManagementSourceMetadata[],
  ): void {
    this.auditEvents
      ?.record({
        type: "promotion.evidence.generated",
        actionFamily: "promotion",
        serviceId: bundle.serviceId,
        severity: bundle.ready ? "info" : "warning",
        message: `Promotion evidence generated for ${bundle.serviceId}`,
        payload: {
          ready: bundle.ready,
          generatedAt: bundle.generatedAt,
          sectionStatuses: Object.fromEntries(
            bundle.sections.map((section) => [section.key, section.status]),
          ),
          sourceMetadata,
        },
      })
      .catch(() => undefined);
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

