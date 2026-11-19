// What a project needs to reach other projects' APIs and to authenticate its workloads: the API access
// requests it has made (and their outcome), and the audiences the gateway accepts for workload tokens.

import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ValidationError } from "@shared/errors";
import { ConsoleAccessService } from "./console-access.service";
import { ConsoleActorGuard, type ConsoleRequest } from "./console-actor.guard";
import type { ConsoleActor } from "./console-access.policy";
import { PublishedApiService } from "./published-api.service";
import { workloadAudiences } from "./workload-identity";

const organizationId = z.string().uuid();
const projectId = z.string().regex(/^prj_[a-z0-9]{24}$/, "must be a prj_ identifier");

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(`${label} ${result.error.issues[0]?.message ?? "is invalid"}`);
  return result.data;
}

function actorOf(req: ConsoleRequest): ConsoleActor {
  if (!req.consoleActor) throw new ValidationError("Console actor is missing");
  return req.consoleActor;
}

@Controller("admin/control-plane")
@UseGuards(ConsoleActorGuard)
export class ConsumerAccessController {
  constructor(
    private readonly apis: PublishedApiService,
    private readonly access: ConsoleAccessService,
  ) {}

  /** API access requests this project made, newest first, with any rejection reason. */
  @Get("organizations/:organizationId/projects/:projectId/api-access-requests/outgoing")
  async outgoing(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const org = parse(organizationId, params.organizationId, "organizationId");
    const project = parse(projectId, params.projectId, "projectId");
    await this.access.require(actorOf(req), org, "project.read", { projectId: project });
    return { success: true, data: await this.apis.listOutgoingRequests(org, project) };
  }

  /** The gateway's CONTROL_PLANE_WORKLOAD_AUDIENCES; a workload binding must use one of them. */
  @Get("organizations/:organizationId/workload-audiences")
  async audiences(@Param("organizationId") rawOrganizationId: string, @Req() req: ConsoleRequest) {
    const org = parse(organizationId, rawOrganizationId, "organizationId");
    await this.access.require(actorOf(req), org, "organization.read");
    return { success: true, data: { audiences: workloadAudiences() } };
  }
}
