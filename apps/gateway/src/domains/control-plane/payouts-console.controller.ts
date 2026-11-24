// The console's payout pages: the payout wallet and schedule, payouts that need a person, payees and
// payouts, and the project's payout settings. Each route checks the console actor's access to the
// project, then forwards to the environment's payments runtime with a signed context for the project.
// Payee account numbers leave the gateway masked.

import { Body, Controller, Get, Header, Optional, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuditEventsService } from "@audit/audit-events.service";
import { ForbiddenError, ValidationError } from "@shared/errors";
import { ConsoleAccessService } from "./console-access.service";
import { ConsoleActorGuard, type ConsoleRequest } from "./console-actor.guard";
import { hasPlatformAccess, requireOperatorPerson, type ConsoleAction } from "./console-access.policy";
import { ConsoleRuntimeContextService } from "./console-runtime-context.service";
import { PaymentsRuntimeClient, type RuntimeFetch } from "./payments-runtime.client";
import { assertFeatureAllowed } from "./features/feature-gate";
import { actorOf, parse } from "./console-request";
import { FeatureNotifications } from "./features/feature-notifications";

const target = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().min(1).max(200),
  environment: z.enum(["test", "live"]),
});
const payeeId = z.string().regex(/^pye_[A-Za-z0-9]+$/);
const payoutId = z.string().regex(/^po_[A-Za-z0-9]+$/);
const pageQuery = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  payeeId: payeeId.optional(),
  status: z.enum(["draft", "submitting", "pending", "unknown", "paid", "failed", "needs_review"]).optional(),
});

/**
 * Reads need environment.read. Changes are for platform operators only: resolving a payout means checking
 * the payment provider's dashboard, which only they can see, and the settings decide who pays transfer fees
 * out of the platform's wallet.
 */
type Route = { action: ConsoleAction; scope: "payments:payouts:read" | "payments:payouts:write"; platformOnly: boolean };
const READ: Route = { action: "environment.read", scope: "payments:payouts:read", platformOnly: false };
const OPERATE: Route = { action: "environment.write", scope: "payments:payouts:write", platformOnly: true };
const WRITE: Route = { ...OPERATE, platformOnly: false };
const LINKED = "/admin/payouts/linked-account";
const PROJECT_FEATURE = z.enum(["payouts_sending", "payee_wallets"]);
const PROJECT_FEATURE_KEYS = { payouts_sending: "payouts.sending", payee_wallets: "payouts.payee_wallets" } as const;

/** Masks a payee's destination account number to its last four digits. */
export function maskPayee(payee: unknown): unknown {
  if (!payee || typeof payee !== "object") return payee;
  const raw = payee as Record<string, unknown>;
  const destination = raw.destination as Record<string, unknown> | null | undefined;
  if (!destination || typeof destination !== "object") return raw;
  const { accountNumber, ...rest } = destination;
  return { ...raw, destination: { ...rest, accountNumberLast4: String(accountNumber ?? "").slice(-4) } };
}

@Controller("admin/control-plane/organizations/:organizationId/projects/:projectId/environments/:environment/payouts")
@UseGuards(ConsoleActorGuard)
export class PayoutsConsoleController {
  private readonly runtime: PaymentsRuntimeClient;

  constructor(private readonly access: ConsoleAccessService, contexts: ConsoleRuntimeContextService,
    private readonly audit: AuditEventsService, @Optional() runtime?: PaymentsRuntimeClient,
    @Optional() private readonly notifications?: FeatureNotifications) {
    this.runtime = runtime ?? new PaymentsRuntimeClient(contexts);
  }

  /** For tests: the runtime call. */
  useFetch(fetchImpl: RuntimeFetch): void {
    this.runtime.useFetch(fetchImpl);
  }

  @Get("overview")
  overview(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    return this.forward(params, req, READ, "GET", "/admin/payouts/overview");
  }

  @Get("settings")
  settings(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    return this.forward(params, req, READ, "GET", "/admin/payouts/settings");
  }

  @Put("project-features/:feature")
  async setProjectFeature(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const feature = parse(PROJECT_FEATURE, params.feature, "feature");
    const { enabled } = parse(z.strictObject({ enabled: z.boolean() }), body, "body");
    // Test is self-service. In live, switching on goes through the feature gate and switching off stays with operators.
    const scope = await this.authorize(params, req, enabled || params.environment === "test" ? WRITE : OPERATE);
    const actor = actorLabel(req);
    let override = false;
    if (enabled && req.consoleActor) {
      const current = z.object({ data: z.object({ enabled: z.boolean() }) }).parse(
        await this.runtime.call(scope, READ.scope, "GET", `/admin/payouts/project-features/${feature}`)).data.enabled;
      override = assertFeatureAllowed(req.consoleActor, PROJECT_FEATURE_KEYS[feature], {},
        { environment: scope.environmentKind, current: { enabled: current } }) === "override";
    }
    const result = await this.runtime.call(scope, OPERATE.scope, "PUT", `/admin/payouts/project-features/${feature}`, { enabled, actor });
    await this.audit.record({
      type: `feature.project_${enabled ? "enabled" : "disabled"}`, message: "Project payout access changed",
      actionFamily: "lifecycle", severity: "info", actor, organizationId: scope.organizationId, projectId: scope.projectId,
      environment: scope.environmentKind, resourceType: "project_feature", resourceId: feature, payload: { enabled },
    });
    if (override) await this.notifications?.override(scope, PROJECT_FEATURE_KEYS[feature], {}, actor);
    return result;
  }

  @Get("project-features/:feature")
  projectFeature(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const feature = parse(PROJECT_FEATURE, params.feature, "feature");
    return this.forward(params, req, READ, "GET", `/admin/payouts/project-features/${feature}`);
  }

  @Get("linked-account")
  linkedAccount(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    return this.forward(params, req, READ, "GET", LINKED);
  }

  @Put("linked-account/enabled")
  async setLinkedAccountEnabled(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const input = z.object({ enabled: z.boolean() }).safeParse(body);
    if (!input.success) throw new ValidationError("enabled must be a boolean");
    let overrideScope;
    if (input.data.enabled && req.consoleActor?.kind === "member") {
      const scope = await this.authorize(params, req, WRITE);
      const state = z.object({ data: z.object({ projectEnabled: z.boolean() }) })
        .safeParse(await this.runtime.call(scope, READ.scope, "GET", LINKED));
      const outcome = assertFeatureAllowed(req.consoleActor, "payouts.merchant_account", {},
        { environment: scope.environmentKind, current: { enabled: state.success && state.data.data.projectEnabled } });
      if (outcome === "override") overrideScope = scope;
    }
    const label = actorLabel(req);
    const route = input.data.enabled || params.environment === "test" ? WRITE : OPERATE;
    const result = await this.linkedMutation(params, req, route, "PUT", "/enabled", { ...input.data, actor: label },
      input.data.enabled ? "project_enabled" : "project_disabled");
    if (overrideScope) await this.notifications?.override(overrideScope, "payouts.merchant_account", {}, label);
    return result;
  }

  @Post("linked-account")
  @Header("Cache-Control", "no-store")
  startLinkedAccount(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    return this.linkedMutation(params, req, WRITE, "POST", "", body, "onboarding_started");
  }

  @Post("linked-account/verification-link")
  @Header("Cache-Control", "no-store")
  reissueLinkedAccountLink(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    return this.linkedMutation(params, req, WRITE, "POST", "/verification-link", body, "link_reissued");
  }

  @Post("linked-account/advance")
  advanceLinkedAccount(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    return this.linkedMutation(params, req, WRITE, "POST", "/advance", body, "onboarding_advanced");
  }

  @Post("linked-account/move")
  moveLinkedAccount(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    return this.linkedMutation(params, req, WRITE, "POST", "/move", body, "project_moved");
  }

  @Post("linked-account/close")
  closeLinkedAccount(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    return this.linkedMutation(params, req, OPERATE, "POST", "/close", body, "closed");
  }

  @Post("settings")
  saveSettings(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const policy = body && typeof body === "object" ? body as Record<string, unknown> : {};
    return this.forward(params, req, OPERATE, "POST", "/admin/payouts/settings", { ...policy, actor: actorLabel(req) });
  }

  @Get("payees")
  async payees(@Param() params: Record<string, string>, @Query() query: Record<string, string>, @Req() req: ConsoleRequest) {
    const page = await this.forward(params, req, READ, "GET", `/payouts/payees${queryString(query)}`) as { success: true; data: { records: unknown[]; nextCursor?: string } };
    return { ...page, data: { ...page.data, records: page.data.records.map(maskPayee) } };
  }

  @Get("payees/:payeeId")
  async payee(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const id = payeeId.safeParse(params.payeeId);
    if (!id.success) throw new ValidationError("payeeId is invalid");
    const result = await this.forward(params, req, READ, "GET", `/payouts/payees/${id.data}`) as { success: true; data: unknown };
    return { ...result, data: maskPayee(result.data) };
  }

  @Get("payouts")
  async payouts(@Param() params: Record<string, string>, @Query() query: Record<string, string>, @Req() req: ConsoleRequest) {
    return this.forward(params, req, READ, "GET", `/payouts${queryString(query)}`);
  }

  @Post("payouts/:payoutId/resolve")
  async resolve(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const id = payoutId.safeParse(params.payoutId);
    if (!id.success) throw new ValidationError("payoutId is invalid");
    const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
    return this.forward(params, req, OPERATE, "POST", `/admin/payouts/${id.data}/resolve`,
      { outcome: input.outcome, note: input.note, actor: actorLabel(req) });
  }

  private async linkedMutation(params: Record<string, string>, req: ConsoleRequest, route: Route, method: "PUT" | "POST",
    path: string, body: unknown, action: string) {
    const response = await this.forward(params, req, route, method, `${LINKED}${path}`, body);
    const result = z.object({ data: z.object({ id: z.string().regex(/^lac_[A-Za-z0-9]+$/).optional() }) }).safeParse(response);
    await this.audit.record({
      type: `linked_account.${action}`, actionFamily: "lifecycle", severity: "info",
      organizationId: params.organizationId, projectId: params.projectId, environment: params.environment,
      actor: actorLabel(req), resourceType: "linked_account",
      resourceId: (result.success ? result.data.data.id : undefined) ?? params.projectId,
      message: `Linked account ${action.replaceAll("_", " ")}`,
    });
    return response;
  }

  private async authorize(params: Record<string, string>, req: ConsoleRequest, route: Route) {
    const parsed = target.safeParse(params);
    if (!parsed.success) throw new ValidationError("organizationId, projectId and environment (test or live) are required");
    if (!req.consoleActor) throw new ValidationError("Console actor is missing");
    const { organizationId, projectId, environment } = parsed.data;
    await this.access.require(req.consoleActor, organizationId, route.action, { projectId, environmentKind: environment });
    if (route.platformOnly && !hasPlatformAccess(req.consoleActor)) {
      throw new ForbiddenError("Only APICenter platform operators can perform this payout action");
    }

    return { organizationId, projectId, environmentKind: environment };
  }

  private async forward(params: Record<string, string>, req: ConsoleRequest, route: Route, method: "GET" | "POST" | "PUT", path: string,
    body?: unknown): Promise<unknown> {
    return this.runtime.call(await this.authorize(params, req, route), route.scope, method, path, body);
  }
}

@Controller("admin/control-plane/payouts/feature-pauses/:environment")
@UseGuards(ConsoleActorGuard)
export class PayoutPausesController {
  constructor(private readonly runtime: PaymentsRuntimeClient, private readonly audit: AuditEventsService) {}

  @Get()
  list(@Param("environment") rawEnvironment: string, @Req() req: ConsoleRequest) {
    if (!hasPlatformAccess(actorOf(req))) throw new ForbiddenError("Only APICenter platform operators can read payout pauses");
    const environment = parse(target.shape.environment, rawEnvironment, "environment");
    return this.runtime.callPlatform(environment, READ.scope, "GET", "/admin/payouts/feature-pauses");
  }

  @Put(":feature")
  async set(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const actor = requireOperatorPerson(actorOf(req));
    const environment = parse(target.shape.environment, params.environment, "environment");
    const feature = parse(z.enum(["payouts_sending", "payee_wallets", "merchant_account"]), params.feature, "feature");
    const { paused, reason } = parse(z.strictObject({ paused: z.boolean(), reason: z.string().trim().min(1).max(500) }), body, "body");
    const result = await this.runtime.callPlatform(environment, OPERATE.scope, "PUT", `/admin/payouts/feature-pauses/${feature}`,
      { paused, reason, actor });
    await this.audit.record({
      type: paused ? "feature.paused" : "feature.resumed", message: paused ? "Feature paused" : "Feature resumed",
      actionFamily: "lifecycle", severity: "info", actor, environment, resourceType: "feature_pause", resourceId: feature,
      payload: { paused, reason },
    });
    return result;
  }
}

function actorLabel(req: ConsoleRequest): string {
  const actor = req.consoleActor!;
  return actor.kind === "member" ? actor.email : `platform:${actor.id}`;
}

function queryString(query: Record<string, string>): string {
  const parsed = pageQuery.safeParse(query ?? {});
  if (!parsed.success) throw new ValidationError("cursor, limit, payeeId or status is invalid");
  const entries = Object.entries(parsed.data).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]);
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
}
