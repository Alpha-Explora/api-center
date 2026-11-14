// Platform-operator API for migrating an organization's legacy tribes, projects and services.

import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ForbiddenError, ValidationError } from "@shared/errors";
import { ConsoleActorGuard, actorLabel, type ConsoleRequest } from "../console-actor.guard";
import { hasPlatformAccess } from "../console-access.policy";
import { LegacyMigrationService } from "./legacy-migration.service";

const BASE = "admin/control-plane/organizations/:organizationId/migration";
const ENV = "projects/:projectId/environments/:environment";

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(`${label}${issue?.path.length ? `.${issue.path.join(".")}` : ""} ${issue?.message ?? "is invalid"}`);
  }
  return result.data;
}

const organizationId = z.string().uuid();
const environmentPath = z.object({
  organizationId,
  projectId: z.string().regex(/^prj_[a-z0-9]{24}$/),
  environment: z.enum(["test", "live"]),
});
const fenceBody = z.object({ expectedFence: z.number().int().min(0), actor: z.string().trim().min(1).max(200).optional() }).strict();

@Controller(BASE)
@UseGuards(ConsoleActorGuard)
export class MigrationController {
  constructor(private readonly migration: LegacyMigrationService) {}

  private platform(req: ConsoleRequest) {
    const actor = req.consoleActor;
    if (!actor || !hasPlatformAccess(actor)) throw new ForbiddenError("Migration is a platform operator action");
    return actor;
  }

  @Get("inventory")
  async inventory(@Param("organizationId") org: string, @Req() req: ConsoleRequest) {
    this.platform(req);
    return { success: true, data: await this.migration.inventory(parse(organizationId, org, "organizationId")) };
  }

  @Post("backfill")
  async backfill(@Param("organizationId") org: string, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const actor = this.platform(req);
    const input = parse(z.object({ revision: z.string().regex(/^[0-9a-f]{64}$/), actor: z.string().min(1).max(200).optional() }).strict(), body, "body");
    return { success: true, data: await this.migration.backfill(parse(organizationId, org, "organizationId"), input.revision, actorLabel(actor, input.actor)) };
  }

  @Get("assignments")
  async assignments(@Param("organizationId") org: string, @Req() req: ConsoleRequest) {
    this.platform(req);
    return { success: true, data: await this.migration.assignments(parse(organizationId, org, "organizationId")) };
  }

  @Get("shadow-mismatches")
  async mismatches(@Param("organizationId") org: string, @Query("all") all: string | undefined, @Req() req: ConsoleRequest) {
    this.platform(req);
    return { success: true, data: await this.migration.mismatches(parse(organizationId, org, "organizationId"), all !== "true") };
  }

  @Post(`${ENV}/shadow-mismatches/resolve`)
  async resolve(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const actor = this.platform(req);
    const path = parse(environmentPath, params, "path");
    const input = parse(z.object({ resolution: z.string().trim().min(3).max(500), actor: z.string().min(1).max(200).optional() }).strict(), body, "body");
    return {
      success: true,
      data: await this.migration.resolveMismatches(path.organizationId, path.projectId, path.environment, input.resolution, actorLabel(actor, input.actor)),
    };
  }

  @Post(`${ENV}/cutover`)
  async cutover(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const actor = this.platform(req);
    const path = parse(environmentPath, params, "path");
    const input = parse(fenceBody, body, "body");
    return {
      success: true,
      data: await this.migration.cutover(path.organizationId, path.projectId, path.environment, input.expectedFence, actorLabel(actor, input.actor)),
    };
  }

  @Post(`${ENV}/rollback`)
  async rollback(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const actor = this.platform(req);
    const path = parse(environmentPath, params, "path");
    const input = parse(fenceBody, body, "body");
    return {
      success: true,
      data: await this.migration.rollback(path.organizationId, path.projectId, path.environment, input.expectedFence, actorLabel(actor, input.actor)),
    };
  }
}
