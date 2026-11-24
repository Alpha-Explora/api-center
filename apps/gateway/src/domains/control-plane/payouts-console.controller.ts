// The console's payout pages: the payout wallet and schedule, payouts that need a person, payees and
// payouts, and the project's payout settings. Each route checks the console actor's access to the
// project, then forwards to the environment's payments runtime with a signed context for the project.
// Payee account numbers leave the gateway masked.

import { Body, Controller, Get, Header, HttpException, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuditEventsService } from "@audit/audit-events.service";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { paymentRuntimeToken, paymentRuntimeUrl } from "@shared/proxy/payment-runtime";
import { BadGatewayError, ForbiddenError, ServiceUnavailableError, ValidationError } from "@shared/errors";
import { ConsoleAccessService } from "./console-access.service";
import { ConsoleActorGuard, type ConsoleRequest } from "./console-actor.guard";
import { hasPlatformAccess, type ConsoleAction } from "./console-access.policy";
import { ConsoleRuntimeContextService } from "./console-runtime-context.service";

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

/** Masks a payee's destination account number to its last four digits. */
export function maskPayee(payee: unknown): unknown {
  if (!payee || typeof payee !== "object") return payee;
  const raw = payee as Record<string, unknown>;
  const destination = raw.destination as Record<string, unknown> | null | undefined;
  if (!destination || typeof destination !== "object") return raw;
  const { accountNumber, ...rest } = destination;
  return { ...raw, destination: { ...rest, accountNumberLast4: String(accountNumber ?? "").slice(-4) } };
}

export type RuntimeFetch = (url: string, init: RequestInit) => Promise<globalThis.Response>;

@Controller("admin/control-plane/organizations/:organizationId/projects/:projectId/environments/:environment/payouts")
@UseGuards(ConsoleActorGuard)
export class PayoutsConsoleController {
  private fetchImpl: RuntimeFetch = (url, init) => fetch(url, init);

  constructor(private readonly access: ConsoleAccessService, private readonly contexts: ConsoleRuntimeContextService,
    private readonly audit: AuditEventsService) {}

  /** For tests: the runtime call. */
  useFetch(fetchImpl: RuntimeFetch): void {
    this.fetchImpl = fetchImpl;
  }

  @Get("overview")
  overview(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    return this.forward(params, req, READ, "GET", "/admin/payouts/overview");
  }

  @Get("settings")
  settings(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    return this.forward(params, req, READ, "GET", "/admin/payouts/settings");
  }

  @Get("linked-account")
  linkedAccount(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    return this.forward(params, req, READ, "GET", LINKED);
  }

  @Put("linked-account/enabled")
  setLinkedAccountEnabled(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const input = z.object({ enabled: z.boolean() }).safeParse(body);
    if (!input.success) throw new ValidationError("enabled must be a boolean");
    return this.linkedMutation(params, req, OPERATE, "PUT", "/enabled", { ...input.data, actor: actorLabel(req) },
      input.data.enabled ? "project_enabled" : "project_disabled");
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

  private async forward(params: Record<string, string>, req: ConsoleRequest, route: Route, method: "GET" | "POST" | "PUT", path: string,
    body?: unknown): Promise<unknown> {
    const parsed = target.safeParse(params);
    if (!parsed.success) throw new ValidationError("organizationId, projectId and environment (test or live) are required");
    if (!req.consoleActor) throw new ValidationError("Console actor is missing");
    const { organizationId, projectId, environment } = parsed.data;
    await this.access.require(req.consoleActor, organizationId, route.action, { projectId, environmentKind: environment });
    if (route.platformOnly && !hasPlatformAccess(req.consoleActor)) {
      throw new ForbiddenError("Only APICenter platform operators can perform this payout action");
    }

    const token = paymentRuntimeToken(environment);
    if (!token) throw new ServiceUnavailableError("Payment runtime token is not configured");
    const context = await this.contexts.sign({ organizationId, projectId, environmentKind: environment, capability: "payments",
      action: route.scope });
    const base = paymentRuntimeUrl(environment);
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-apicenter-context": context.signedContext,
      "x-apicenter-environment": environment,
      "x-apicenter-owner-tribe-id": context.resourceOwner.groupId,
      "x-apicenter-project-id": context.resourceOwner.projectId,
      "x-apicenter-consumer-service-id": "console",
      "x-correlation-id": context.requestId,
    };
    const cloudRunAuthorization = await getCloudRunAuthorizationHeader(base);
    if (cloudRunAuthorization) headers["x-serverless-authorization"] = cloudRunAuthorization;

    let response: globalThis.Response;
    try {
      response = await this.fetchImpl(`${base}${path}`, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new BadGatewayError(`Payment runtime unavailable: ${(error as Error).message}`);
    }
    const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (!response.ok) {
      throw new HttpException(payload ?? { success: false, error: { code: "PAYMENT_RUNTIME_ERROR", message: `HTTP ${response.status}` } },
        response.status);
    }
    return payload;
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
