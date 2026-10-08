import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { TribeQuotaPolicyService } from "@quotas/tribe-quota-policy.service";
import { RegistryService } from "@registry/registry.service";
import { ForbiddenError } from "@shared/errors";
import { AuthenticatedRequest } from "../../../types";

@Controller("developer-portal")
@UseGuards(JwtAuthGuard)
export class DeveloperPortalController {
  constructor(
    private readonly registry: RegistryService,
    private readonly quotaPolicies: TribeQuotaPolicyService,
  ) {}

  @Get("me")
  me(@Req() req: AuthenticatedRequest) {
    const caller = this.resolveCaller(req);
    return this.response(
      {
        ...caller,
        scopes: req.user?.scopes ?? [],
      },
      req,
      caller.tribeId,
    );
  }

  /** The calling service's project siblings and the services it explicitly consumes. */
  @Get("services")
  services(@Req() req: AuthenticatedRequest) {
    const caller = this.resolveCaller(req);
    return this.response(
      this.registry.getDeveloperPortalServices(caller.serviceId),
      req,
      caller.tribeId,
    );
  }

  /** The caller's project budgets plus its tribe's ceilings. */
  @Get("quotas")
  async quotas(@Req() req: AuthenticatedRequest) {
    const caller = this.resolveCaller(req);
    return this.response(
      await this.quotaPolicies.listPoliciesForPortal(caller.tribeId, caller.projectId),
      req,
      caller.tribeId,
    );
  }

  @Get("topics")
  topics(@Req() req: AuthenticatedRequest) {
    const { tribeId } = this.resolveCaller(req);
    const tenantTopicPrefix = `tribe.${tribeId}.`;
    return this.response(
      {
        tenantTopicPrefix,
        recommendedTopics: [
          `${tenantTopicPrefix}events`,
          `${tenantTopicPrefix}commands`,
          `${tenantTopicPrefix}audit`,
        ],
        requiredScopes: {
          read: ["external:kafka:read"],
          publish: ["external:kafka:write"],
        },
      },
      req,
      tribeId,
    );
  }

  @Get("onboarding")
  async onboarding(@Req() req: AuthenticatedRequest) {
    const caller = this.resolveCaller(req);
    const tribeId = caller.tribeId;
    const services = this.registry.getDeveloperPortalServices(caller.serviceId);
    const quotas = await this.quotaPolicies.listPoliciesForPortal(tribeId, caller.projectId);

    return this.response(
      {
        checklist: [
          {
            key: "registered_service",
            label: "Register tribe service",
            complete: services.ownedServices.length > 0,
          },
          {
            key: "allowed_services",
            label: "Confirm shared-service access",
            complete: services.allowedServices.length > 0,
          },
          {
            key: "quota_policy",
            label: "Review active quota policy",
            complete: quotas.some((policy) => policy.status === "active"),
          },
          {
            key: "event_topics",
            label: "Use governed tenant topics",
            complete: true,
          },
        ],
        sdk: {
          packageName: "@implementsprint/sdk",
          baseUrlEnv: "APICENTER_BASE_URL",
          tokenEnv: "APICENTER_TOKEN",
        },
        credentialVersion: {
          status: "managed",
          rotation: "coordinate through API Center Management",
        },
      },
      req,
      tribeId,
    );
  }

  private resolveCaller(req: AuthenticatedRequest): {
    serviceId: string;
    projectId?: string;
    tribeId: string;
  } {
    const tribeId = req.tribeId ?? req.user?.tribeId;
    const serviceId = req.sourceServiceId ?? req.user?.sourceServiceId ?? req.user?.sub;
    if (!tribeId || !serviceId) {
      throw new ForbiddenError(
        "Developer portal requires a service token with tribeId and sourceServiceId claims",
      );
    }

    return { serviceId, projectId: req.projectId ?? req.user?.projectId, tribeId };
  }

  private response<T>(data: T, req: AuthenticatedRequest, tribeId: string) {
    return {
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        tribeId,
        correlationId: req.correlationId,
      },
    };
  }
}
