import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Optional,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuditEventsService } from "@audit/audit-events.service";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { ManagementSourceMetadata } from "@shared/source-metadata";
import { ApprovalRequestService } from "@approvals/approval-request.service";
import { TribePlanService } from "@entitlements/tribe-plan.service";
import { TribeQuotaPolicyService } from "@quotas/tribe-quota-policy.service";
import { RegistryService } from "@registry/registry.service";
import { PromotionEvidenceBundleService } from "./promotion-evidence-bundle.service";
import { VerificationEvidenceService } from "./verification-evidence.service";

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
    @Optional() private readonly verification?: VerificationEvidenceService,
  ) {}

  @Get(":serviceId")
  async getEvidence(
    @Param("serviceId") serviceId: string,
    @Query("format") format: string | undefined,
    @Query("environment") environment: string = "live",
  ) {
    if (environment !== "test" && environment !== "live")
      throw new BadRequestException("Environment must be test or live");
    const entry = this.registry.get(serviceId);
    if (!entry) throw new NotFoundException("Service not found");
    const ownerTribeId = readOwnerTribeId(entry);
    const projectId = entry?.projectId;
    const paymentRequired = entry.consumes.some(
      (id) => id === "payment" || id === "payments",
    );
    const [quotaPolicies, planAssignments, approval, paymentApproval] =
      await Promise.all([
        ownerTribeId
          ? this.quotaPolicies.listPoliciesForPortal(ownerTribeId, projectId)
          : Promise.resolve([]),
        projectId
          ? this.plans.listPlanAssignments({
              projectId,
              environment,
              status: "active",
            })
          : Promise.resolve([]),
        environment === "live"
          ? this.approvals.findApprovedAction({
              actionType: "service.register_live",
              targetEnvironment: environment,
              targetId: serviceId,
            })
          : Promise.resolve(null),
        paymentRequired && projectId && environment === "live"
          ? this.approvals.findApprovedAction({
              actionType: "payments.live_access",
              targetEnvironment: environment,
              targetId: projectId,
            })
          : Promise.resolve(null),
      ]);

    const verification = await this.verification
      ?.latest(serviceId, environment)
      .catch(() => null);
    const observedHealth = verification?.checks.find(
      (check) => check.checkId === "health",
    );

    const bundle = this.evidence.build({
      serviceId,
      targetEnvironment: environment,
      health: {
        status:
          observedHealth?.status === "passed"
            ? "up"
            : (observedHealth?.status ?? "missing"),
      },
      quotaPolicy:
        quotaPolicies.find((policy) => policy.status === "active") ?? null,
      planAssignment:
        planAssignments.find(
          (assignment) =>
            assignment.status === "active" &&
            new Date(assignment.effectiveAt).getTime() <= Date.now(),
        ) ?? null,
      approval,
      approvalRequired: environment === "live",
      paymentRequired: paymentRequired && environment === "live",
      paymentApproval,
      smoke: { status: verification?.ready ? "passed" : "missing" },
      manifest: {
        status: entry.environments?.some(
          (row) => row.environment === environment,
        )
          ? "valid"
          : "missing",
      },
      pipeline: null,
      pipelineRequired: entry.consumes.includes("kafka"),
    });

    const sourceMetadata = [this.evidence.getSourceMetadata()];
    this.recordPromotionEvidenceAudit(bundle, sourceMetadata);

    if (format === "md") {
      return this.toMarkdown(bundle);
    }

    return {
      success: true,
      data: bundle,
      meta: {
        sourceMetadata,
        verification: verification ?? null,
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
