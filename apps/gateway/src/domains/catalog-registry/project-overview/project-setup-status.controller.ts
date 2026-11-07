import { Controller, ForbiddenException, Get, NotFoundException, Param, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import type { AuthenticatedRequest } from "../../../types";
import { RegistryService } from "../registry/registry.service";
import { ProjectSetupStatusService } from "./project-setup-status.service";

@Controller("setup")
@UseGuards(JwtAuthGuard)
export class ConsumerSetupStatusController {
  constructor(private readonly setupStatus: ProjectSetupStatusService) {}

  @Get("status")
  async getStatus(@Req() req: AuthenticatedRequest) {
    const claims = req.user;
    const serviceId = claims?.sourceServiceId ?? claims?.sub;
    const environment = claims?.environment;
    const projectId = claims?.projectId;
    if (!serviceId || !projectId || (environment !== "test" && environment !== "live")) {
      throw new ForbiddenException("The authenticated service token has no project and environment context");
    }
    return {
      success: true,
      data: await this.setupStatus.getStatus({
        projectId,
        serviceId,
        environment,
        scopes: [...(claims?.scopes ?? []), ...(claims?.permissions ?? [])],
      }),
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId },
    };
  }
}

@Controller("tenancy/projects/:projectId/setup-status")
@UseGuards(ScopedAdminGuard)
export class OperatorProjectSetupStatusController {
  constructor(
    private readonly setupStatus: ProjectSetupStatusService,
    private readonly registry: RegistryService,
  ) {}

  @Get()
  async getStatus(
    @Param("projectId") projectId: string,
    @Query("serviceId") serviceId: string,
    @Query("environment") environment: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!serviceId || !this.registry.get(serviceId)) throw new NotFoundException("Service is not registered");
    if (environment !== "test" && environment !== "live") throw new NotFoundException("Environment must be test or live");
    const service = this.registry.get(serviceId)!;
    if (service.projectId !== projectId) throw new NotFoundException("Service was not found in this project");
    const scopes = this.registry.getCallableServiceIds(serviceId).flatMap((targetId) =>
      this.registry.get(targetId)?.requiredScopes ?? [],
    );
    return {
      success: true,
      data: await this.setupStatus.getStatus({ projectId, serviceId, environment, scopes }),
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId },
    };
  }
}
