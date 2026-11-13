import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ValidationError } from "@shared/errors";
import { ConsoleAccessService } from "../console-access.service";
import { ConsoleActorGuard, actorLabel, type ConsoleRequest } from "../console-actor.guard";
import type { EnvironmentScope } from "../control-plane-admin.service";
import { EventDestinationService } from "./event-destination.service";

const ENV = "organizations/:organizationId/projects/:projectId/environments/:environment";

const createSchema = z
  .object({
    recipientApplicationId: z.string().regex(/^app_[a-z0-9]{24}$/),
    pushEndpoint: z.string().url().max(2048),
    oidcAudience: z.string().url().max(2048).optional(),
    deliveryServiceAccountEmail: z.string().email().max(320),
    actor: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

function scopeFrom(params: Record<string, string>): EnvironmentScope {
  const organizationId = z.string().uuid().safeParse(params.organizationId);
  const projectId = z.string().regex(/^prj_[a-z0-9]{24}$/).safeParse(params.projectId);
  const environment = z.enum(["test", "live"]).safeParse(params.environment);
  if (!organizationId.success || !projectId.success || !environment.success) throw new ValidationError("Invalid environment path");
  return { organizationId: organizationId.data, projectId: projectId.data, environmentKind: environment.data };
}

@Controller("admin/control-plane")
@UseGuards(ConsoleActorGuard)
export class EventDestinationsController {
  constructor(
    private readonly destinations: EventDestinationService,
    private readonly access: ConsoleAccessService,
  ) {}

  @Post(`${ENV}/event-destinations`)
  async create(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const scope = scopeFrom(params);
    const parsed = createSchema.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError(`body ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    const actor = req.consoleActor!;
    await this.access.require(actor, scope.organizationId, "environment.write", { projectId: scope.projectId, environmentKind: scope.environmentKind });
    const { actor: onBehalfOf, ...input } = parsed.data;
    return { success: true, data: await this.destinations.create(scope, input, actorLabel(actor, onBehalfOf)) };
  }

  @Get(`${ENV}/event-destinations`)
  async list(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const scope = scopeFrom(params);
    await this.access.require(req.consoleActor!, scope.organizationId, "environment.read", { projectId: scope.projectId, environmentKind: scope.environmentKind });
    return { success: true, data: await this.destinations.list(scope) };
  }

  @Post(`${ENV}/event-destinations/:destinationId/disable`)
  async disable(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const scope = scopeFrom(params);
    if (!/^dst_[a-z0-9]{24}$/.test(params.destinationId ?? "")) throw new ValidationError("Invalid destination ID");
    const actor = req.consoleActor!;
    await this.access.require(actor, scope.organizationId, "environment.write", { projectId: scope.projectId, environmentKind: scope.environmentKind });
    return { success: true, data: await this.destinations.disable(scope, params.destinationId, actorLabel(actor)) };
  }
}
