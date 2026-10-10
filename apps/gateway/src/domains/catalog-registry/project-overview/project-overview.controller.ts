import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import type { AuthenticatedRequest } from "../../../types";
import { ProjectOverviewService } from "./project-overview.service";

@Controller("tenancy/projects")
@UseGuards(ScopedAdminGuard)
export class ProjectOverviewController {
  constructor(private readonly overview: ProjectOverviewService) {}

  @Get(":projectId/overview")
  async getOverview(
    @Param("projectId") projectId: string,
    @Query("organizationId") organizationId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.overview.getOverview(projectId, organizationId),
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId },
    };
  }
}
