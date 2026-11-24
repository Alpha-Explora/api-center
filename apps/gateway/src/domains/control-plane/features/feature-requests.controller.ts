import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AppError } from "@shared/errors";
import { ConsoleAccessService } from "../console-access.service";
import { ConsoleActorGuard, type ConsoleRequest } from "../console-actor.guard";
import { canPerform, requireOperatorPerson } from "../console-access.policy";
import { actorOf, organizationIdSchema, parse } from "../console-request";
import { PaymentsRuntimeClient } from "../payments-runtime.client";
import { FeatureAppliers } from "./feature-appliers";
import { FEATURE_CATALOG, FEATURE_KEYS, featureKeySchema } from "./feature-catalog";
import { featureReason, FeatureRequestService } from "./feature-request.service";

const ENV = "organizations/:organizationId/projects/:projectId/environments/:environment";
const scopeSchema = z.object({ organizationId: organizationIdSchema,
  projectId: z.string().regex(/^prj_[a-z0-9]{24}$/), environment: z.enum(["test", "live"]) })
  .transform(({ organizationId, projectId, environment }) => ({ organizationId, projectId, environmentKind: environment }));
const requestId = z.string().regex(/^frq_[a-z0-9]{24}$/);
const createInput = z.strictObject({ feature: featureKeySchema, change: z.record(z.string(), z.unknown()), reason: featureReason });
const decisionInput = z.discriminatedUnion("approve", [
  z.strictObject({ approve: z.literal(true) }),
  z.strictObject({ approve: z.literal(false), note: featureReason }),
]);
const pauseSchema = z.object({ data: z.array(z.object({ feature: z.string(), paused: z.boolean() })) });
const PAUSES = {
  "payouts.sending": "payouts_sending", "payouts.payee_wallets": "payee_wallets", "payouts.merchant_account": "merchant_account",
} as const;

@Controller("admin/control-plane")
@UseGuards(ConsoleActorGuard)
export class FeatureRequestsController {
  constructor(private readonly access: ConsoleAccessService, private readonly requests: FeatureRequestService,
    private readonly appliers: FeatureAppliers, private readonly payments: PaymentsRuntimeClient) {}

  @Get(`${ENV}/features`)
  async list(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const scope = parse(scopeSchema, params, "scope");
    await this.access.require(actorOf(req), scope.organizationId, "environment.read", scope);
    const [requests, pauseResult] = await Promise.all([this.requests.listForEnvironment(scope),
      this.payments.call(scope, "payments:payouts:read", "GET", "/admin/payouts/feature-pauses").catch(() => null)]);
    const pauses = pauseSchema.safeParse(pauseResult);
    return { success: true, data: FEATURE_KEYS.map((key) => {
      const definition = FEATURE_CATALOG[key];
      const pause = key in PAUSES && pauses.success
        ? pauses.data.data.find((row) => row.feature === PAUSES[key as keyof typeof PAUSES]) : undefined;
      return {
        key, title: definition.title, description: definition.description, release: definition.release,
        offered: definition.environments.includes(scope.environmentKind), paused: pause?.paused ?? false,
        pending: requests.find((row) => row.feature === key && row.status === "pending") ?? null,
        last: requests.find((row) => row.feature === key && row.status !== "pending") ?? null,
      };
    }) };
  }

  @Post(`${ENV}/feature-requests`)
  async create(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const scope = parse(scopeSchema, params, "scope");
    const input = parse(createInput, body, "body");
    const actor = actorOf(req);
    if (actor.kind !== "member") throw new AppError("Sign in to request feature access", 403, "PERSON_REQUIRED");
    await this.access.require(actor, scope.organizationId, input.feature === "plan.upgrade" ? "project.manage" : "environment.write", scope);
    return { success: true, data: await this.requests.create(scope, input, actor.email) };
  }

  @Post(`${ENV}/feature-requests/:requestId/cancel`)
  async cancel(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const scope = parse(scopeSchema, params, "scope");
    const actor = actorOf(req);
    if (actor.kind !== "member") throw new AppError("Sign in to cancel a feature request", 403, "PERSON_REQUIRED");
    const access = await this.access.require(actor, scope.organizationId, "environment.write", scope);
    return { success: true, data: await this.requests.cancel(scope, parse(requestId, params.requestId, "requestId"),
      actor.email, canPerform(actor, access, "project.manage", scope)) };
  }

  @Post("feature-requests/:requestId/decision")
  async decide(@Param("requestId") rawId: string, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const decider = requireOperatorPerson(actorOf(req));
    const id = parse(requestId, rawId, "requestId");
    const decision = parse(decisionInput, body, "body");
    const { token, request } = await this.requests.claim(id, decider, decision.approve);
    let change: Record<string, unknown> = {};
    try {
      if (decision.approve) {
        const scope = { organizationId: request.organizationId, projectId: request.projectId, environmentKind: request.environmentKind };
        change = await this.appliers.apply(scope, request.feature, request.change, decider);
      }
    } catch (error) {
      await this.requests.release(id, token);
      throw error;
    }
    const status = decision.approve ? "approved" : "rejected";
    const decided = await this.requests.finish(id, token, { status, decider, ...(decision.approve ? {} : { note: decision.note }) });
    await this.requests.record(status, decided, decider, change);
    return { success: true, data: decided };
  }
}
