// A project's test recipients. Reading needs read access to the test environment; adding and
// removing needs write access to it, as for any other test-environment change.

import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ValidationError } from "@shared/errors";
import { ConsoleAccessService } from "./console-access.service";
import { ConsoleActorGuard, actorLabel, type ConsoleRequest } from "./console-actor.guard";
import type { ConsoleAction, ConsoleActor } from "./console-access.policy";
import { TestRecipientsService } from "./test-recipients.service";

const RECIPIENTS = "organizations/:organizationId/projects/:projectId/test-recipients";

const schemas = {
  organizationId: z.string().uuid(),
  projectId: z.string().regex(/^prj_[a-z0-9]{24}$/, "must be a prj_ identifier"),
  add: z.object({ recipient: z.string().trim().min(3).max(254), actor: z.string().trim().min(1).max(200).optional() }).strict(),
  recipient: z.string().trim().min(3).max(254),
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

function actorOf(req: ConsoleRequest): ConsoleActor {
  if (!req.consoleActor) throw new ValidationError("Console actor is missing");
  return req.consoleActor;
}

@Controller("admin/control-plane")
@UseGuards(ConsoleActorGuard)
export class TestRecipientsController {
  constructor(
    private readonly recipients: TestRecipientsService,
    private readonly access: ConsoleAccessService,
  ) {}

  @Get(RECIPIENTS)
  async list(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { organizationId, projectId } = await this.authorize(params, req, "environment.read");
    return { success: true, data: await this.recipients.list(organizationId, projectId) };
  }

  @Post(RECIPIENTS)
  async add(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const { organizationId, projectId, actor } = await this.authorize(params, req, "environment.write");
    const input = parse(schemas.add, body, "body");
    return { success: true, data: await this.recipients.add(organizationId, projectId, input.recipient, actorLabel(actor, input.actor)) };
  }

  @Delete(`${RECIPIENTS}/:recipient`)
  async remove(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { organizationId, projectId, actor } = await this.authorize(params, req, "environment.write");
    const recipient = parse(schemas.recipient, params.recipient, "recipient");
    return { success: true, data: await this.recipients.remove(organizationId, projectId, recipient, actorLabel(actor)) };
  }

  private async authorize(params: Record<string, string>, req: ConsoleRequest, action: ConsoleAction) {
    const organizationId = parse(schemas.organizationId, params.organizationId, "organizationId");
    const projectId = parse(schemas.projectId, params.projectId, "projectId");
    const actor = actorOf(req);
    await this.access.require(actor, organizationId, action, { projectId, environmentKind: "test" });
    return { organizationId, projectId, actor };
  }
}
