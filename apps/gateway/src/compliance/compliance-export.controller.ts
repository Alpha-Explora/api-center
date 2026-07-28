import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { AuditEventsService } from "../analytics/audit-events.service";
import { PromotionEvidenceBundleService } from "../operations/promotion-evidence-bundle.service";
import { ComplianceExportService } from "./compliance-export.service";

@Controller("admin/compliance/export")
@UseGuards(ScopedAdminGuard)
export class ComplianceExportController {
  constructor(
    private readonly auditEvents: AuditEventsService,
    private readonly compliance: ComplianceExportService,
    private readonly evidence: PromotionEvidenceBundleService,
  ) {}

  @Get()
  async export(
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Query("format") format: string | undefined,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const auditEvents = await this.auditEvents.listWithSourceMetadata({
      limit: 500,
      from,
      to,
    });
    const evidenceBundles = this.evidence.listBundlesWithSourceMetadata();
    const packet = this.compliance.buildPacket({
      from: from ?? "",
      to: to ?? "",
      auditEvents: auditEvents.data,
      evidenceBundles: evidenceBundles.data as Array<Record<string, any>>,
    });

    if (format === "md") {
      res?.type("text/markdown");
      return this.compliance.toMarkdown(packet);
    }

    return {
      success: true,
      data: packet,
      meta: {
        sourceMetadata: [
          auditEvents.sourceMetadata,
          evidenceBundles.sourceMetadata,
        ],
      },
    };
  }
}
