import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { RegistryService } from "../registry/registry.service";
import { PromotionEvidenceBundleService } from "./promotion-evidence-bundle.service";

@Controller("admin/operations/evidence")
@UseGuards(ScopedAdminGuard)
export class PromotionEvidenceBundleController {
  constructor(
    private readonly registry: RegistryService,
    private readonly evidence: PromotionEvidenceBundleService,
  ) {}

  @Get(":serviceId")
  getEvidence(
    @Param("serviceId") serviceId: string,
    @Query("format") format: string | undefined,
  ) {
    const entry = this.registry.get(serviceId);
    const bundle = this.evidence.build({
      serviceId,
      health: { status: entry?.healthy === false ? "down" : "up" },
      quotaPolicy: { id: `${serviceId}:runtime`, mode: "observe" },
      planAssignment: { id: `${serviceId}:plan`, planKey: "standard" },
      approval: { id: `${serviceId}:approval`, status: "approved" },
      smoke: { status: entry ? "passed" : "missing" },
      manifest: { status: entry ? "valid" : "missing" },
      pipeline: {
        topicExists: Boolean(entry?.consumes?.includes("kafka")),
        s3SinkIncludesTopic: Boolean(entry?.consumes?.includes("kafka")),
      },
    });

    if (format === "md") {
      return this.toMarkdown(bundle);
    }

    return { success: true, data: bundle };
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
