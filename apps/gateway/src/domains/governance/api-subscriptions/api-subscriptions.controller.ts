import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthService } from "@auth/auth.service";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { ForbiddenError, ValidationError } from "@shared/errors";
import type { AuthenticatedRequest } from "../../../types";
import { ApiSubscriptionsService } from "./api-subscriptions.service";
import { RegistryService } from "@registry/registry.service";
import {
  RequestApiSubscriptionDto,
  SubscriptionDecisionDto,
} from "./api-subscriptions.dto";

@Controller("admin/api-subscriptions")
@UseGuards(ScopedAdminGuard)
export class ApiSubscriptionsController {
  constructor(
    private readonly subscriptions: ApiSubscriptionsService,
    private readonly registry: RegistryService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  async request(
    @Body() body: RequestApiSubscriptionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireConsumerAccess(body.consumerProjectId, req);
    return {
      success: true,
      data: await this.subscriptions.request(this.actor(req), body),
    };
  }

  @Get()
  async list(
    @Query("consumerProjectId") consumerProjectId: string | undefined,
    @Query("apiServiceId") apiServiceId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (consumerProjectId) this.requireConsumerAccess(consumerProjectId, req);
    if (apiServiceId) this.requireApiOwner(apiServiceId, req);
    return {
      success: true,
      data: await this.subscriptions.list({ consumerProjectId, apiServiceId }),
    };
  }

  @Patch(":id/:action")
  async decide(
    @Param("id") id: string,
    @Param("action") action: string,
    @Body() body: SubscriptionDecisionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    if (action !== "approve" && action !== "reject" && action !== "revoke") {
      throw new ValidationError("Action must be approve, reject, or revoke");
    }
    const current = await this.subscriptions.get(id);
    this.requireApiOwner(current.apiServiceId, req);
    return {
      success: true,
      data: await this.subscriptions.decide(
        id,
        this.actor(req),
        action,
        body.reason,
      ),
    };
  }

  private requireConsumerAccess(projectId: string, req: AuthenticatedRequest) {
    if (!this.isPlatformAdmin(req) && req.projectId !== projectId) {
      throw new ForbiddenError(
        "Only the consumer project or a platform admin may manage this subscription",
      );
    }
  }

  private requireApiOwner(serviceId: string, req: AuthenticatedRequest) {
    const service = this.registry.get(serviceId);
    if (!service)
      throw new ForbiddenError(
        "Only the API owner or a platform admin may manage requests",
      );
    if (!this.isPlatformAdmin(req) && req.projectId !== service.projectId) {
      throw new ForbiddenError(
        "Only the API owner or a platform admin may manage requests",
      );
    }
  }

  private isPlatformAdmin(req: AuthenticatedRequest) {
    return (
      !req.user ||
      this.auth.mergeCallerScopes(req.user).includes("platform:admin")
    );
  }

  private actor(req: AuthenticatedRequest) {
    return req.user?.sub ?? req.sourceServiceId ?? "platform-admin";
  }
}
