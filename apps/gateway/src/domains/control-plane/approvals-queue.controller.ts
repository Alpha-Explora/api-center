// The approvals queue: pending live activation requests and API access requests. Platform operators
// list every organization's; anyone else lists their organization's items that their role lets them
// decide (project.manage on the deciding project). Decisions use the existing routes.

import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { ForbiddenError } from "@shared/errors";
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
  async all(@Req() req: ConsoleRequest) {
    const actor = actorOf(req);
    if (!hasPlatformAccess(actor)) throw new ForbiddenError("The cross-organization approvals queue is for platform operators");
    return { success: true, data: withRequester(actor, await this.queue.list("platform")) };
  }

  @Get("organizations/:organizationId/approvals")
  async forOrganization(@Param("organizationId") organizationId: string, @Req() req: ConsoleRequest) {
    const org = parse(organizationIdSchema, organizationId, "organizationId");
    const actor = actorOf(req);
    const access = await this.access.require(actor, org, "organization.read");
    const items = (await this.queue.list({ organizationId: org })).filter((item) =>
      canPerform(actor, access, "project.manage", { projectId: item.projectId }),
    );
    return { success: true, data: withRequester(actor, items) };
  }
}

/** Marks the actor's own requests: the decide routes refuse a requester deciding their own. */
function withRequester(actor: ConsoleActor, items: ApprovalItem[]) {
  const self = actor.kind === "member" ? actor.email : undefined;
  return items.map((item) => ({ ...item, requestedByYou: self !== undefined && item.requestedBy.toLowerCase() === self }));
}
