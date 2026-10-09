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
import { PlatformAdminOrServiceGuard } from "@auth/guards/platform-admin-or-service.guard";
import { ConflictError, ForbiddenError, ValidationError } from "@shared/errors";
import type { AuthenticatedRequest } from "../../../types";
import { ApiSubscriptionsService } from "./api-subscriptions.service";
import { RegistryService } from "@registry/registry.service";
import {
  RequestApiSubscriptionDto,
  SubscriptionDecisionDto,
} from "./api-subscriptions.dto";

type ApiSubscriptionRequest = AuthenticatedRequest & {
  platformAdmin?: boolean;
};

@Controller("admin/api-subscriptions")
@UseGuards(PlatformAdminOrServiceGuard)
export class ApiSubscriptionsController {
  constructor(
    private readonly subscriptions: ApiSubscriptionsService,
    private readonly registry: RegistryService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  async request(
    @Body() body: RequestApiSubscriptionDto,
    @Req() req: ApiSubscriptionRequest,
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
    @Req() req: ApiSubscriptionRequest,
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
    @Req() req: ApiSubscriptionRequest,
  ) {
    if (action !== "approve" && action !== "reject" && action !== "revoke") {
      throw new ValidationError("Action must be approve, reject, or revoke");
    }
    const current = await this.subscriptions.get(id);
    if (current.apiServiceId !== body.apiServiceId) {
      throw new ConflictError(
        "API service does not match the subscription request",
      );
    }
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

  private requireConsumerAccess(
    projectId: string,
    req: ApiSubscriptionRequest,
  ) {
    if (
      !this.isPlatformAdmin(req) &&
      (!req.projectId || req.projectId !== projectId)
    ) {
      throw new ForbiddenError(
        "Only the consumer project or a platform admin may manage this subscription",
      );
    }
  }

  private requireApiOwner(serviceId: string, req: ApiSubscriptionRequest) {
    const service = this.registry.get(serviceId);
    if (!service)
      throw new ForbiddenError(
        "Only the API owner or a platform admin may manage requests",
      );
    if (
      !this.isPlatformAdmin(req) &&
      (!req.projectId || req.projectId !== service.projectId)
    ) {
      throw new ForbiddenError(
        "Only the API owner or a platform admin may manage requests",
      );
    }
  }

  private isPlatformAdmin(req: ApiSubscriptionRequest) {
    return (
      req.platformAdmin === true ||
      (req.user !== undefined &&
        this.auth.mergeCallerScopes(req.user).includes("platform:admin"))
    );
  }

  private actor(req: ApiSubscriptionRequest) {
    if (this.isPlatformAdmin(req)) {
      const actor = req.headers["x-apicenter-actor"];
      if (typeof actor === "string" && actor.trim()) return actor.trim();
    }
    return req.user?.sub ?? req.sourceServiceId ?? "platform-admin";
  }
}
