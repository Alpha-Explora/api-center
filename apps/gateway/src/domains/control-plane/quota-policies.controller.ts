// Editing and deleting quota policies. A project policy needs project.manage on its project; a shared
// ceiling needs organization.quotas.manage, as for changing a policy's status.

import { Body, Controller, Delete, Param, Put, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ValidationError } from "@shared/errors";
import { ConsoleAccessService } from "./console-access.service";
import { ConsoleActorGuard, actorLabel, type ConsoleRequest } from "./console-actor.guard";
import type { ConsoleActor } from "./console-access.policy";
import { QuotaService } from "./quota.service";

const POLICY = "organizations/:organizationId/quota-policies/:policyId";

const schemas = {
  organizationId: z.string().uuid(),
  policyId: z.string().regex(/^qp_[a-z0-9]{24}$/, "must be a qp_ identifier"),
  change: z
    .object({
      capability: z.string().min(1).max(32).nullable().optional(),
      windowSeconds: z.number().int().min(1).max(2_678_400).optional(),
      maxRequests: z.number().int().min(1).max(2_000_000_000).optional(),
      mode: z.enum(["observe", "enforce"]).optional(),
      actor: z.string().trim().min(1).max(200).optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).some((field) => field !== "actor"), "must change at least one field"),
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
export class QuotaPoliciesController {
  constructor(
    private readonly quotas: QuotaService,
    private readonly access: ConsoleAccessService,
  ) {}

  /** Changes a policy's window, limit, mode or capability (null: every capability). */
  @Put(POLICY)
  async update(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const { organizationId, policyId, actor } = await this.authorize(params, req);
    const { actor: onBehalfOf, ...change } = parse(schemas.change, body, "body");
    return { success: true, data: await this.quotas.updatePolicy(organizationId, policyId, change, actorLabel(actor, onBehalfOf)) };
  }

  /** Soft-deletes a policy: it stops applying immediately and is kept only for the audit trail. */
  @Delete(POLICY)
  async remove(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { organizationId, policyId, actor } = await this.authorize(params, req);
    return { success: true, data: await this.quotas.deletePolicy(organizationId, policyId, actorLabel(actor)) };
  }

  private async authorize(params: Record<string, string>, req: ConsoleRequest) {
    const organizationId = parse(schemas.organizationId, params.organizationId, "organizationId");
    const policyId = parse(schemas.policyId, params.policyId, "policyId");
    const actor = actorOf(req);
    // Membership first, so a stranger cannot learn which policy IDs exist.
    await this.access.require(actor, organizationId, "organization.read");
    const policy = await this.quotas.policyProject(organizationId, policyId);
    if (policy.scope === "project" && policy.projectId && policy.createdLevel !== "organization") {
      await this.access.require(actor, organizationId, "project.manage", { projectId: policy.projectId });
    } else {
      await this.access.require(actor, organizationId, "organization.quotas.manage");
    }
    return { organizationId, policyId, actor };
  }
}
