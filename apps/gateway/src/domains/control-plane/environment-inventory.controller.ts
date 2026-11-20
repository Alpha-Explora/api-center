import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ValidationError } from "@shared/errors";
import { ConsoleAccessService } from "./console-access.service";
import { ConsoleActorGuard, type ConsoleRequest } from "./console-actor.guard";
import type { EnvironmentScope } from "./control-plane-admin.service";
import { EnvironmentInventoryService } from "./environment-inventory.service";

const ENV = "organizations/:organizationId/projects/:projectId/environments/:environment";

const scopeSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().regex(/^prj_[a-z0-9]{24}$/),
  environment: z.enum(["test", "live"]),
});
const expiringSchema = z.coerce.number().int().min(1).max(365).optional();

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${label}.${issue.path.join(".")}` : label;
    throw new ValidationError(`${path} ${issue?.message ?? "is invalid"}`);
  }
  return result.data;
}

/** Environment-wide credential and grant listings, across every application. */
@Controller("admin/control-plane")
@UseGuards(ConsoleActorGuard)
export class EnvironmentInventoryController {
  constructor(
    private readonly inventory: EnvironmentInventoryService,
    private readonly access: ConsoleAccessService,
  ) {}

  /** Active keys, soonest expiry first; `expiringWithinDays` narrows to keys expiring within that window or already expired. */
  @Get(`${ENV}/credentials`)
  async credentials(@Param() params: Record<string, string>, @Query("expiringWithinDays") expiring: unknown, @Req() req: ConsoleRequest) {
    const scope = await this.authorize(params, req);
    const expiringWithinDays = parse(expiringSchema, expiring, "expiringWithinDays");
    return { success: true, data: await this.inventory.activeCredentials(scope, { expiringWithinDays }) };
  }

  @Get(`${ENV}/grants`)
  async grants(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const scope = await this.authorize(params, req);
    return { success: true, data: await this.inventory.activeGrants(scope) };
  }

  private async authorize(params: Record<string, string>, req: ConsoleRequest): Promise<EnvironmentScope> {
    const path = parse(scopeSchema, params, "path");
    const scope: EnvironmentScope = { organizationId: path.organizationId, projectId: path.projectId, environmentKind: path.environment };
    await this.access.require(req.consoleActor!, scope.organizationId, "environment.read", { projectId: scope.projectId, environmentKind: scope.environmentKind });
    return scope;
  }
}
