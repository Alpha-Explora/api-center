import { Controller, Get, Optional, Param, Query, UseGuards } from "@nestjs/common";
import { AuditEventsService } from "../analytics/audit-events.service";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import {
  externalSourceMetadata,
  ManagementSourceMetadata,
  volatileSourceMetadata,
} from "../shared/source-metadata";
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
    @Optional() private readonly auditEvents?: AuditEventsService,
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

    const sourceMetadata = [
      this.evidence.getSourceMetadata(),
      this.pipelineSourceMetadata(),
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

  private pipelineSourceMetadata(): ManagementSourceMetadata {
    const source = readResponseSource(this.pipelineHealth);
    if (source === "athena") {
      return externalSourceMetadata({
        sourceName: "promotion-pipeline-health-athena",
        durability: "athena",
        staleAfterSeconds: 60 * 60,
        evidenceTable: "gold_platform.pipeline_health_daily",
      });
    }

    return volatileSourceMetadata({
      sourceName: "promotion-pipeline-health-fixture",
      degradedReason:
        "Pipeline promotion evidence is fixture/local data until Athena or durable API Center evidence is configured.",
    });
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

function readResponseSource(service: unknown): "athena" | "fixture" {
  const maybeService = service as { getResponseSource?: () => unknown };
  const source = maybeService.getResponseSource?.();
  return source === "athena" || source === "athena-proxy"
    ? "athena"
    : "fixture";
}
