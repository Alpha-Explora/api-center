import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Optional,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuditEventsService } from "../analytics/audit-events.service";
import { requireGovernanceDependency } from "../shared/governance-dependencies";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { AuthenticatedRequest } from "../types";
import {
  CreateRegistrationRequestDto,
  RejectRegistrationRequestDto,
} from "./registration-request.dto";
import {
  RegistrationRequestsService,
  ServiceRegistrationRequest,
} from "./registration-requests.service";
import {
  ServiceEnvironmentKey,
  ServiceManifest,
  ServiceTier,
  ServiceType,
} from "../types";

@Controller("registry/registration-requests")
@UseGuards(ScopedAdminGuard)
export class RegistrationRequestsController {
  constructor(
    private readonly requests: RegistrationRequestsService,
    @Optional() private readonly auditEvents?: AuditEventsService,
  ) {}

  @Post()
  async create(
    @Body() dto: CreateRegistrationRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const request = await this.requests.createRequest({
      manifest: normalizeManifest(dto.manifest),
      requestedBy: dto.requestedBy,
    });
    await this.recordRegistrationRequested(request, req);

    return response(request);
  }

  @Get()
  async list(@Query("status") status?: "pending" | "rejected" | "applied") {
    const requests = await this.requests.listRequests(status);
    return response(requests, { total: requests.length });
  }

  @Post(":requestId/approve")
  async approve(
    @Param("requestId") requestId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = req.user?.sub ?? "platform-admin";
    const request = await this.requests.approveRequest(requestId, actor);
    await this.recordRegistrationDecision(request, actor, "approved");
    return response(request);
  }

  @Post(":requestId/reject")
  async reject(
    @Param("requestId") requestId: string,
    @Body() dto: RejectRegistrationRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = req.user?.sub ?? "platform-admin";
    const request = await this.requests.rejectRequest(
      requestId,
      actor,
      dto.reason,
    );
    await this.recordRegistrationDecision(request, actor, "rejected");
    return response(request);
  }

  private async recordRegistrationRequested(
    request: ServiceRegistrationRequest,
    req: AuthenticatedRequest,
  ): Promise<void> {
    const auditEvents = requireGovernanceDependency(
      this.auditEvents,
      "AuditEventsService",
    );
    await auditEvents.recordRequired({
      type: "registry.service.create_requested",
      actionFamily: "registration",
      actor: req.user?.sub ?? request.requestedBy ?? "platform-admin",
      serviceId: request.serviceId,
      resourceType: "registry_change_request",
      resourceId: request.id,
      environment: this.resolveRegistrationEnvironment(request),
      correlationId: req.correlationId ?? request.id,
      severity: "info",
      message: `Registry create requested for ${request.serviceId}`,
      payload: {
        requestId: request.id,
        ownerTribeId: request.ownerTribeId,
        status: request.status,
        requestedBy: request.requestedBy,
      },
    });
  }

  private async recordRegistrationDecision(
    request: ServiceRegistrationRequest,
    actor: string,
    decision: "approved" | "rejected",
  ) {
    const auditEvents = requireGovernanceDependency(
      this.auditEvents,
      "AuditEventsService",
    );
    await auditEvents.recordRequired({
      type: `approval.request.${decision}`,
      actionFamily: "approval",
      actor,
      serviceId: request.serviceId,
      resourceType: "registry_change_request",
      resourceId: request.id,
      environment: this.resolveRegistrationEnvironment(request),
      correlationId: request.id,
      severity: decision === "approved" ? "info" : "warning",
      message: `Registration request ${decision} for ${request.serviceId}`,
      payload: {
        requestId: request.id,
        ownerTribeId: request.ownerTribeId,
        status: request.status,
        appliedServiceId: request.appliedServiceId,
        rejectionReason: request.rejectionReason,
      },
    });
  }

  private resolveRegistrationEnvironment(
    request: ServiceRegistrationRequest,
  ): string {
    return request.manifest.environments?.[0]?.environment ?? "test";
  }
}

function response(
  data: ServiceRegistrationRequest | ServiceRegistrationRequest[],
  meta: Record<string, unknown> = {},
) {
  return {
    success: true,
    data,
    meta: {
      ...meta,
      timestamp: new Date().toISOString(),
    },
  };
}

function normalizeManifest(
  manifest: CreateRegistrationRequestDto["manifest"],
): ServiceManifest {
  return {
    ...manifest,
    consumes: manifest.consumes ?? [],
    environments: normalizeManifestEnvironments(manifest),
    serviceTier: manifest.serviceTier as ServiceTier | undefined,
    serviceType: (manifest.serviceType ?? "tribe") as ServiceType,
  };
}

function normalizeManifestEnvironments(
  manifest: CreateRegistrationRequestDto["manifest"],
): NonNullable<ServiceManifest["environments"]> {
  if (manifest.environments?.length) {
    return manifest.environments.map((environment) => ({
      environment: environment.environment as ServiceEnvironmentKey,
      baseUrl: environment.baseUrl,
      healthCheck: environment.healthCheck ?? manifest.healthCheck,
      status: "active",
    }));
  }

  return [
    {
      environment: (manifest.targetEnvironment ??
        "test") as ServiceEnvironmentKey,
      baseUrl: manifest.baseUrl,
      healthCheck: manifest.healthCheck,
      status: "active",
    },
  ];
}
