// Console read routes for observability: the request log and usage of a project environment, its
// quota meters, and the organization and platform audit logs.

import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ForbiddenError, NotFoundError, ValidationError } from "@shared/errors";
import { ConsoleAccessService } from "../console-access.service";
import { ConsoleActorGuard, type ConsoleRequest } from "../console-actor.guard";
import { auditScope, hasPlatformAccess, type ConsoleActor } from "../console-access.policy";
import type { EnvironmentScope } from "../control-plane-admin.service";
import { ObservabilityService } from "./observability.service";
import { requestLogQuery } from "./request-log";
import { usageRangeQuery } from "./usage-series";
import { auditLogQuery, platformAuditLogQuery } from "./audit-log";

const ENV = "organizations/:organizationId/projects/:projectId/environments/:environment";

const pathSchemas = {
  organizationId: z.string().uuid(),
  projectId: z.string().regex(/^prj_[a-z0-9]{24}$/, "must be a prj_ identifier"),
  environment: z.enum(["test", "live"]),
};

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${label}.${issue.path.join(".")}` : label;
    throw new ValidationError(`${path} ${issue?.message ?? "is invalid"}`);
  }
  return result.data;
}

function scopeFrom(params: Record<string, string>): EnvironmentScope {
  return {
    organizationId: parse(pathSchemas.organizationId, params.organizationId, "organizationId"),
    projectId: parse(pathSchemas.projectId, params.projectId, "projectId"),
    environmentKind: parse(pathSchemas.environment, params.environment, "environment"),
  };
}

function actorOf(req: ConsoleRequest): ConsoleActor {
  if (!req.consoleActor) throw new ValidationError("Console actor is missing");
  return req.consoleActor;
}

@Controller("admin/control-plane")
@UseGuards(ConsoleActorGuard)
export class ObservabilityController {
  constructor(
    private readonly observability: ObservabilityService,
    private readonly access: ConsoleAccessService,
  ) {}

  /** Recent requests made by the environment's applications, newest first. */
  @Get(`${ENV}/requests`)
  async requests(@Param() params: Record<string, string>, @Query() query: unknown, @Req() req: ConsoleRequest) {
    const scope = await this.authorizeEnvironment(params, req);
    return { success: true, data: await this.observability.requestLog(scope, parse(requestLogQuery, query, "query")) };
  }

  /** Requests per hour (24h) or per UTC day (7d, 30d), by application and by action. */
  @Get(`${ENV}/usage/series`)
  async usageSeries(@Param() params: Record<string, string>, @Query() query: unknown, @Req() req: ConsoleRequest) {
    const scope = await this.authorizeEnvironment(params, req);
    const { range } = parse(usageRangeQuery, query, "query");
    return { success: true, data: await this.observability.usageSeries(scope, range) };
  }

  /** Current-window usage of the plan's daily budget and of every quota policy covering the environment. */
  @Get(`${ENV}/quota-usage`)
  async quotaUsage(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const scope = await this.authorizeEnvironment(params, req);
    return { success: true, data: await this.observability.quotaMeters(scope) };
  }

  /** Owners and admins read every event in the organization; a project admin reads their projects' events. */
  @Get("organizations/:organizationId/audit-events")
  async organizationAudit(@Param("organizationId") rawOrganizationId: string, @Query() query: unknown, @Req() req: ConsoleRequest) {
    const organizationId = parse(pathSchemas.organizationId, rawOrganizationId, "organizationId");
    const input = parse(auditLogQuery, query, "query");
    const actor = actorOf(req);
    const access = await this.access.require(actor, organizationId, "organization.read");
    const scope = auditScope(actor, access);
    if (!scope) throw new ForbiddenError("Only organization owners and admins, and project admins, can read the audit log");
    if (input.projectId && scope.kind === "projects" && !scope.projectIds.includes(input.projectId)) {
      throw new NotFoundError(`Project '${input.projectId}' was not found`);
    }
    return { success: true, data: await this.observability.auditLog(organizationId, scope, input) };
  }

  /** Every organization's events, and platform events without an organization. Platform operators only. */
  @Get("audit-events")
  async platformAudit(@Query() query: unknown, @Req() req: ConsoleRequest) {
    if (!hasPlatformAccess(actorOf(req))) throw new ForbiddenError("The platform audit log is for platform operators");
    const { organizationId, ...input } = parse(platformAuditLogQuery, query, "query");
    return { success: true, data: await this.observability.auditLog(organizationId, { kind: "organization" }, input) };
  }

  private async authorizeEnvironment(params: Record<string, string>, req: ConsoleRequest) {
    const scope = scopeFrom(params);
    await this.access.require(actorOf(req), scope.organizationId, "environment.read", {
      projectId: scope.projectId,
      environmentKind: scope.environmentKind,
    });
    return scope;
  }
}
