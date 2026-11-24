// Operators see all requests. Organization members can follow feature requests for projects they
// can read and see activation and API access requests for projects they manage.

import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { ForbiddenError, ValidationError } from "@shared/errors";
import { ConsoleAccessService } from "./console-access.service";
import { ConsoleActorGuard, type ConsoleRequest } from "./console-actor.guard";
import { canPerform, hasPlatformAccess, type ConsoleActor } from "./console-access.policy";
import { actorOf, organizationIdSchema, parse } from "./console-request";
import { ApprovalsQueueService } from "./approvals-queue.service";
import type { ApprovalItem } from "./approvals-queue";

@Controller("admin/control-plane")
@UseGuards(ConsoleActorGuard)
export class ApprovalsQueueController {
  constructor(
    private readonly queue: ApprovalsQueueService,
    private readonly access: ConsoleAccessService,
  ) {}

  @Get("approvals")
  async all(@Query("state") state: unknown, @Req() req: ConsoleRequest) {
    const actor = actorOf(req);
    if (!hasPlatformAccess(actor)) throw new ForbiddenError("The cross-organization approvals queue is for platform operators");
    return { success: true, data: withRequester(actor, await this.queue.list("platform", queueState(state))) };
  }

  @Get("organizations/:organizationId/approvals")
  async forOrganization(@Param("organizationId") organizationId: string, @Query("state") state: unknown, @Req() req: ConsoleRequest) {
    const org = parse(organizationIdSchema, organizationId, "organizationId");
    const actor = actorOf(req);
    const access = await this.access.require(actor, org, "organization.read");
    const items = (await this.queue.list({ organizationId: org }, queueState(state))).filter((item) =>
      canPerform(actor, access, item.kind === "feature" ? "project.read" : "project.manage", { projectId: item.projectId }),
    );
    return { success: true, data: withRequester(actor, items) };
  }
}

/** Marks the actor's own requests: the decide routes refuse a requester deciding their own. */
function withRequester(actor: ConsoleActor, items: ApprovalItem[]) {
  const self = actor.kind === "member" ? actor.email : undefined;
  return items.map((item) => ({ ...item, requestedByYou: self !== undefined && item.requestedBy.toLowerCase() === self }));
}

/** `?state=decided` asks for recently decided items; anything else (or nothing) means waiting ones. */
function queueState(raw: unknown): "pending" | "decided" {
  if (raw === undefined || raw === "pending") return "pending";
  if (raw === "decided") return "decided";
  throw new ValidationError("state must be pending or decided");
}
