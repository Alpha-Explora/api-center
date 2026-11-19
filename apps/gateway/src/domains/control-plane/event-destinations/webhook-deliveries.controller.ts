import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ValidationError } from "@shared/errors";
import { ConsoleAccessService } from "../console-access.service";
import { ConsoleActorGuard, actorLabel, type ConsoleRequest } from "../console-actor.guard";
import type { EnvironmentScope } from "../control-plane-admin.service";
import { WebhookDeliveriesService } from "./webhook-deliveries.service";

const DESTINATION = "organizations/:organizationId/projects/:projectId/environments/:environment/event-destinations/:destinationId";

const pathSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().regex(/^prj_[a-z0-9]{24}$/),
  environment: z.enum(["test", "live"]),
  destinationId: z.string().regex(/^dst_[a-z0-9]{24}$/),
});
const limitSchema = z.coerce.number().int().min(1).max(100).default(50);
const testEventSchema = z.object({ actor: z.string().trim().min(1).max(200).optional() }).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${label}.${issue.path.join(".")}` : label;
    throw new ValidationError(`${path} ${issue?.message ?? "is invalid"}`);
  }
  return result.data;
}

function target(params: Record<string, string>): { scope: EnvironmentScope; destinationId: string } {
  const path = parse(pathSchema, params, "path");
  return {
    scope: { organizationId: path.organizationId, projectId: path.projectId, environmentKind: path.environment },
    destinationId: path.destinationId,
  };
}

/** A signed webhook's delivery history and on-demand test events. */
@Controller("admin/control-plane")
@UseGuards(ConsoleActorGuard)
export class WebhookDeliveriesController {
  constructor(
    private readonly deliveries: WebhookDeliveriesService,
    private readonly access: ConsoleAccessService,
  ) {}

  @Get(`${DESTINATION}/deliveries`)
  async list(@Param() params: Record<string, string>, @Query("limit") limit: unknown, @Req() req: ConsoleRequest) {
    const { scope, destinationId } = target(params);
    const count = parse(limitSchema, limit, "limit");
    await this.access.require(req.consoleActor!, scope.organizationId, "environment.read", { projectId: scope.projectId, environmentKind: scope.environmentKind });
    return { success: true, data: await this.deliveries.list(scope, destinationId, count) };
  }

  @Post(`${DESTINATION}/test-event`)
  async sendTestEvent(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const { scope, destinationId } = target(params);
    const input = parse(testEventSchema, body ?? {}, "body");
    const actor = req.consoleActor!;
    await this.access.require(actor, scope.organizationId, "environment.write", { projectId: scope.projectId, environmentKind: scope.environmentKind });
    return { success: true, data: await this.deliveries.sendTestEvent(scope, destinationId, actorLabel(actor, input.actor)) };
  }
}
