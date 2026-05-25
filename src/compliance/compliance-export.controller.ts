import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { AuditEventsService } from "../analytics/audit-events.service";
import { ComplianceExportService } from "./compliance-export.service";

@Controller("admin/compliance/export")
@UseGuards(ScopedAdminGuard)
export class ComplianceExportController {
  constructor(
    private readonly auditEvents: AuditEventsService,
    private readonly compliance: ComplianceExportService,
  ) {}

  @Get()
  async export(
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
  ) {
    const auditEvents = await this.auditEvents.list({ limit: 200 });
    return {
      success: true,
      data: this.compliance.buildPacket({
        from: from ?? "",
        to: to ?? "",
        auditEvents,
        evidenceBundles: [],
      }),
    };
  }
}
