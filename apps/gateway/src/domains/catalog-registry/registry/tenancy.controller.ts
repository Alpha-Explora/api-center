// =============================================================================
// Tenancy admin API: tribes, projects, and the services inside them.
// =============================================================================

import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { AuditEventsService } from "@analytics/audit-events.service";
import { NotFoundError } from "@shared/errors";
import {
  CreateProjectDto,
  CreateTribeDto,
  UpdateProjectDto,
  UpdateTribeDto,
} from "@shared/dto/tenancy.dto";
import type { AuthenticatedRequest, ServiceRegistryEntry } from "../../../types";
import { RegistryService } from "./registry.service";
import { TenancyService } from "./tenancy.service";
import type { Project, Tribe } from "./tenancy.types";

@Controller("tenancy")
@UseGuards(ScopedAdminGuard)
export class TenancyController {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly registry: RegistryService,
    private readonly auditEvents: AuditEventsService,
  ) {}

  @Get("tribes")
  listTribes(@Req() req: AuthenticatedRequest) {
    return this.response(
      this.tenancy.listTribes().map((tribe) => ({
        ...tribe,
        projects: this.tenancy
          .listProjects({ tribeId: tribe.tribeId })
          .map((project) => ({
            ...project,
            serviceCount: this.registry.getProjectServices(project.projectId).length,
          })),
      })),
      req,
    );
  }

  @Post("tribes")
  async createTribe(@Body() body: CreateTribeDto, @Req() req: AuthenticatedRequest) {
    const tribe = await this.tenancy.createTribe(body);
    await this.audit(req, "tenancy.tribe.created", "tribe", tribe.tribeId, { tribe });
    return this.response(tribe, req);
  }

  @Get("tribes/:tribeId")
  getTribe(@Param("tribeId") tribeId: string, @Req() req: AuthenticatedRequest) {
    const tribe = this.requireTribe(tribeId);
    return this.response(
      {
        ...tribe,
        projects: this.tenancy
          .listProjects({ tribeId })
          .map((project) => this.projectView(project)),
      },
      req,
    );
  }

  @Patch("tribes/:tribeId")
  async updateTribe(
    @Param("tribeId") tribeId: string,
    @Body() body: UpdateTribeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const tribe = await this.tenancy.updateTribe(tribeId, body);
    await this.audit(req, "tenancy.tribe.updated", "tribe", tribeId, { changes: body });
    return this.response(tribe, req);
  }

  @Post("tribes/:tribeId/projects")
  async createProject(
    @Param("tribeId") tribeId: string,
    @Body() body: CreateProjectDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const project = await this.tenancy.createProject({ ...body, tribeId });
    await this.audit(req, "tenancy.project.created", "project", project.projectId, { project });
    return this.response(project, req);
  }

  @Get("projects/:projectId")
  getProject(@Param("projectId") projectId: string, @Req() req: AuthenticatedRequest) {
    const project = this.tenancy.getProject(projectId);
    if (!project) throw new NotFoundError(`Project '${projectId}' is not registered`);
    return this.response(
      { ...this.projectView(project), tribe: this.requireTribe(project.tribeId) },
      req,
    );
  }

  @Patch("projects/:projectId")
  async updateProject(
    @Param("projectId") projectId: string,
    @Body() body: UpdateProjectDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const project = await this.tenancy.updateProject(projectId, body);
    await this.audit(req, "tenancy.project.updated", "project", projectId, { changes: body });
    return this.response(project, req);
  }

  private requireTribe(tribeId: string): Tribe {
    const tribe = this.tenancy.getTribe(tribeId);
    if (!tribe) throw new NotFoundError(`Tribe '${tribeId}' is not registered`);
    return tribe;
  }

  private projectView(project: Project) {
    return {
      ...project,
      services: this.registry
        .getProjectServices(project.projectId)
        .map((service) => summarizeService(service)),
    };
  }

  private async audit(
    req: AuthenticatedRequest,
    type: string,
    resourceType: "tribe" | "project",
    resourceId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.auditEvents.recordRequired({
      type,
      actionFamily: "registration",
      actor: req.user?.sub ?? req.tribeId ?? "platform-admin",
      resourceType,
      resourceId,
      environment: "live",
      correlationId: req.correlationId ?? resourceId,
      severity: "info",
      message: `${type} for ${resourceId}`,
      payload,
    });
  }

  private response<T>(data: T, req: AuthenticatedRequest) {
    return {
      success: true,
      data,
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId },
    };
  }
}

function summarizeService(service: ServiceRegistryEntry) {
  return {
    serviceId: service.serviceId,
    name: service.name,
    status: service.status,
    consumes: service.consumes,
    environments: service.environments.map((environment) => ({
      environment: environment.environment,
      status: environment.status,
    })),
  };
}
