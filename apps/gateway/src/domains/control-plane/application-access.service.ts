// Authenticates an application credential and authorizes one request on a capability or a
// published API. Identity comes from the stored credential row alone; nothing the client sends
// selects the organization, project, environment or application. Reads authoritative state on
// every request (no cache), so revocation and grant removal take effect immediately.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { AppError, UnauthorizedError } from "@shared/errors";
import { credentialOrganization, withTenant, type TenantDb } from "./tenant-transaction";
import { credentialMatches, parseApplicationCredential } from "./application-credential";
import { decideCapabilityAccess } from "./capability-access.policy";
import { isCatalogedAction, resolveCapabilityAction } from "./capability-catalog";
import { matchApiOperation } from "./api-operations";
import { assertMerchantBinding } from "./merchant-binding";
import { RuntimeContextSigner } from "./runtime-context.signer";
import { QuotaService } from "./quota.service";
import type { ApplicationIdentity, AuthorizedCapabilityCall, EnvironmentKind } from "./control-plane.types";

const LAST_USED_RESOLUTION_MS = 60_000;

export interface CapabilityRequest {
  bearer: string;
  capability: string;
  method: string;
  /** Path relative to the capability root, e.g. `/send`. */
  relativePath: string;
  requestId: string;
  /** The caller's Idempotency-Key, when sent. Retries of one operation are counted once. */
  idempotencyKey?: string;
}

export interface ApiRequest {
  bearer: string;
  apiId: string;
  method: string;
  /** Path relative to the API root, e.g. `/orders/42`. */
  relativePath: string;
  requestId: string;
  idempotencyKey?: string;
}

/** An authorized call on a published API, with the upstream it forwards to. */
export interface AuthorizedApiCall extends AuthorizedCapabilityCall {
  upstreamUrl: string;
}

export type AccessTarget =
  | { kind: "capability"; capability: string; action: (db: TenantDb) => Promise<string | undefined> | string | undefined }
  | { kind: "api"; apiId: string; method: string; relativePath: string };

type Target = AccessTarget;

/**
 * Who is calling. A credential identifies itself. A migrated legacy service, already
 * authenticated by its legacy token, is identified by the application it was mapped to.
 */
type Principal = { kind: "credential"; bearer: string } | { kind: "mapped"; organizationId: string; applicationId: string };

/** A request target expressed without resolver callbacks, for callers outside this module. */
export type RequestTarget =
  | { kind: "capability"; capability: string; method: string; relativePath: string }
  | { kind: "api"; apiId: string; method: string; relativePath: string };

function toAccessTarget(target: RequestTarget): AccessTarget {
  if (target.kind === "api") return target;
  const action = resolveCapabilityAction(target.capability, target.method, target.relativePath);
  return { kind: "capability", capability: target.capability, action: () => action };
}

interface ResolvedTarget {
  id: string;
  status: string;
  action: string | undefined;
  upstreamUrl?: string;
}

@Injectable()
export class ApplicationAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: RuntimeContextSigner,
    private readonly quota: QuotaService,
  ) {}

  /** Authorizes a request on a capability route; the route maps to its catalogued action. */
  async authorize(request: CapabilityRequest, now = new Date()): Promise<AuthorizedCapabilityCall> {
    const action = resolveCapabilityAction(request.capability, request.method, request.relativePath);
    return this.authorizeTarget(request, { kind: "capability", capability: request.capability, action: () => action }, now);
  }

  /**
   * Authorizes a catalogued action directly, for facades that map their own routes to actions
   * (payments). An action not catalogued for the capability is denied.
   */
  async authorizeAction(
    request: Omit<CapabilityRequest, "method" | "relativePath"> & { action: string },
    now = new Date(),
  ): Promise<AuthorizedCapabilityCall> {
    const action = isCatalogedAction(request.capability, request.action) ? request.action : undefined;
    return this.authorizeTarget(request, { kind: "capability", capability: request.capability, action: () => action }, now);
  }

  /** Authorizes a request on a published API of the caller's organization and environment kind. */
  async authorizeApi(request: ApiRequest, now = new Date()): Promise<AuthorizedApiCall> {
    const call = await this.authorizeTarget(
      request,
      { kind: "api", apiId: request.apiId, method: request.method, relativePath: request.relativePath },
      now,
    );
    return call as AuthorizedApiCall;
  }

  /**
   * Authorizes a migrated legacy service whose project environment is now governed by the
   * control plane. The legacy token already authenticated it; its mapped application's explicit
   * grants decide, and its requests are counted and signed like any application's.
   */
  async authorizeMapped(
    principal: { organizationId: string; applicationId: string },
    target: RequestTarget,
    request: { requestId: string; idempotencyKey?: string },
    now = new Date(),
  ): Promise<AuthorizedCapabilityCall & { upstreamUrl?: string }> {
    return this.authorizeTarget({ ...request, principal: { kind: "mapped", ...principal } }, toAccessTarget(target), now);
  }

  /**
   * What the control plane would decide for a mapped legacy service, with no side effects: no
   * usage counted, nothing signed. Used to shadow legacy decisions before cutover.
   */
  async evaluateMapped(principal: { organizationId: string; applicationId: string }, target: RequestTarget, now = new Date()) {
    const loaded = await this.load({ kind: "mapped", ...principal }, toAccessTarget(target));
    if (!loaded) return { allowed: false as const, action: undefined };
    const decision = this.decide(loaded, target.kind, now);
    return { allowed: decision.allowed, action: loaded.resolved?.action };
  }

  /** Records how an admitted request ended, for usage reporting. */
  async recordOutcome(call: AuthorizedCapabilityCall, statusCode: number): Promise<void> {
    await this.quota.complete(call.identity, call.requestKey, statusCode);
  }

  private async authorizeTarget(
    request: ({ bearer: string } | { principal: Principal }) & { requestId: string; idempotencyKey?: string },
    target: Target,
    now: Date,
  ): Promise<AuthorizedCapabilityCall & { upstreamUrl?: string }> {
    const principal: Principal = "principal" in request ? request.principal : { kind: "credential", bearer: request.bearer };
    const loaded = await this.load(principal, target);
    if (!loaded) throw new UnauthorizedError("Invalid application credential");
    const decision = this.decide(loaded, target.kind, now);
    if (!decision.allowed) {
      const status = decision.denial.kind === "authentication" ? 401 : 403;
      throw new AppError(denialMessage(decision.denial.code), status, decision.denial.code);
    }
    const { credential, scope, environment, application, ownerMapping, resolved } = loaded;

    const usageTarget = target.kind === "api" ? `api:${target.apiId}` : target.capability;
    if (usageTarget === "payments") assertMerchantBinding(scope.organizationId);
    if (credential.id) await this.touchLastUsed(scope.organizationId, credential.id, credential.lastUsedAt, now);

    const identity: ApplicationIdentity = {
      ...scope,
      environmentKind: environment.kind as EnvironmentKind,
      applicationId: application.id,
      credentialId: credential.id ?? `legacy:${application.id}`,
    };
    const requestKey = request.idempotencyKey
      ? `idem:${application.id}:${decision.action}:${request.idempotencyKey}`
      : `req:${request.requestId}`;
    await this.quota.reserve(identity, usageTarget, decision.action, requestKey, now);

    // Records stay scoped to the legacy owner of a migrated project until they are reconciled.
    const resourceOwner = ownerMapping
      ? { groupId: ownerMapping.ownerGroupId, projectId: ownerMapping.ownerProjectId }
      : { groupId: scope.organizationId, projectId: scope.projectId };
    // Runtimes verify audience apicenter-runtime:<capability>; API publishers verify apicenter-api:<apiId>.
    const audienceTarget = target.kind === "api" ? `api:${target.apiId}` : target.capability;
    return {
      identity,
      requestKey,
      resourceOwner,
      capability: usageTarget,
      action: decision.action,
      ...(resolved?.upstreamUrl ? { upstreamUrl: resolved.upstreamUrl } : {}),
      signedContext: this.signer.sign({
        identity,
        resourceOwner,
        capability: audienceTarget,
        action: decision.action,
        requestId: request.requestId,
        now,
      }),
    };
  }

  /**
   * Loads everything one decision needs in one tenant transaction. Returns undefined when the
   * principal does not resolve (unknown or mismatched credential, unmapped application).
   */
  private async load(principal: Principal, target: Target) {
    let organizationId: string | undefined;
    let lookupPrefix: string | undefined;
    let presentedKind: EnvironmentKind | undefined;
    if (principal.kind === "credential") {
      const parsed = parseApplicationCredential(principal.bearer);
      if (!parsed) return undefined;
      lookupPrefix = parsed.lookupPrefix;
      presentedKind = parsed.environmentKind;
      organizationId = await credentialOrganization(this.prisma, parsed.lookupPrefix);
    } else {
      organizationId = principal.organizationId;
    }
    if (!organizationId) return undefined;

    const loaded = await withTenant(this.prisma, { organizationId }, async (db) => {
      let credential: { id?: string; status: string; expiresAt: Date; environmentKind: string; lastUsedAt: Date | null; applicationId: string; organizationId: string; projectId: string; environmentId: string };
      if (principal.kind === "credential") {
        const row = await db.cpCredential.findUnique({ where: { lookupPrefix } });
        if (!row || !credentialMatches(principal.bearer, row.verifierSha256)) return undefined;
        credential = row;
      } else {
        const app = await db.cpApplication.findFirst({ where: { id: principal.applicationId, organizationId } });
        if (!app) return undefined;
        const appEnvironment = await db.cpEnvironment.findFirst({ where: { id: app.environmentId, organizationId } });
        if (!appEnvironment) return undefined;
        // The legacy token authenticated this caller; there is no control-plane credential to check.
        credential = {
          status: "active",
          expiresAt: new Date(8.64e15),
          environmentKind: appEnvironment.kind,
          lastUsedAt: null,
          applicationId: app.id,
          organizationId: app.organizationId,
          projectId: app.projectId,
          environmentId: app.environmentId,
        };
        presentedKind = appEnvironment.kind as EnvironmentKind;
      }
      const scope = {
        organizationId: credential.organizationId,
        projectId: credential.projectId,
        environmentId: credential.environmentId,
      };
      const [organization, project, environment, application, grants, ownerMapping] = await Promise.all([
        db.organization.findUnique({ where: { id: scope.organizationId }, select: { status: true } }),
        db.cpProject.findFirst({ where: { id: scope.projectId, organizationId: scope.organizationId } }),
        db.cpEnvironment.findFirst({ where: { id: scope.environmentId, organizationId: scope.organizationId, projectId: scope.projectId } }),
        db.cpApplication.findFirst({ where: { id: credential.applicationId, ...scope } }),
        db.cpApplicationGrant.findMany({
          where: { applicationId: credential.applicationId, ...scope, status: "active" },
          select: { targetKind: true, targetId: true, action: true, status: true },
        }),
        db.cpResourceOwnerMapping.findFirst({
          where: { organizationId: scope.organizationId, projectId: scope.projectId, environmentKind: credential.environmentKind },
        }),
      ]);
      const resolved = await this.resolveTarget(db, target, scope, credential.environmentKind as EnvironmentKind);
      return { credential, scope, organization, project, environment, application, grants, ownerMapping, resolved };
    });
    // Composite foreign keys make gaps impossible; treat one as an unresolved principal.
    if (!loaded || !loaded.organization || !loaded.project || !loaded.environment || !loaded.application) return undefined;
    return {
      ...loaded,
      organization: loaded.organization,
      project: loaded.project,
      environment: loaded.environment,
      application: loaded.application,
      presentedKind: presentedKind as EnvironmentKind,
    };
  }

  private decide(loaded: NonNullable<Awaited<ReturnType<ApplicationAccessService["load"]>>>, targetKind: "capability" | "api", now: Date) {
    const { credential, organization, project, environment, application, grants, resolved } = loaded;
    return decideCapabilityAccess({
      now,
      presentedKind: loaded.presentedKind,
      organizationStatus: organization.status,
      project,
      environment: { kind: environment.kind as EnvironmentKind, status: environment.status },
      application,
      credential: {
        status: credential.status,
        expiresAt: credential.expiresAt,
        environmentKind: credential.environmentKind as EnvironmentKind,
      },
      targetKind,
      capability: resolved ? { id: resolved.id, status: resolved.status } : undefined,
      action: resolved?.action,
      grants,
    });
  }

  private async resolveTarget(
    db: TenantDb,
    target: Target,
    scope: { organizationId: string; projectId: string; environmentId: string },
    environmentKind: EnvironmentKind,
  ): Promise<ResolvedTarget | undefined> {
    if (target.kind === "capability") {
      const installation = await db.cpCapabilityInstallation.findFirst({ where: { capability: target.capability, ...scope } });
      const action = await target.action(db);
      return installation ? { id: installation.capability, status: installation.status, action } : { id: target.capability, status: "absent", action };
    }
    // Same organization is guaranteed by the tenant transaction; the environment kind must match.
    const api = await db.cpPublishedApi.findFirst({ where: { id: target.apiId, organizationId: scope.organizationId } });
    if (!api) return undefined;
    const operations = await db.cpPublishedApiOperation.findMany({ where: { apiId: api.id, organizationId: scope.organizationId } });
    const usable = api.status === "active" && api.environmentKind === environmentKind;
    return {
      id: api.id,
      status: usable ? "enabled" : "disabled",
      action: matchApiOperation(operations, target.method, target.relativePath),
      upstreamUrl: api.upstreamUrl,
    };
  }

  private async touchLastUsed(organizationId: string, credentialId: string, lastUsedAt: Date | null, now: Date) {
    if (lastUsedAt && now.getTime() - lastUsedAt.getTime() < LAST_USED_RESOLUTION_MS) return;
    try {
      await withTenant(this.prisma, { organizationId }, (db) =>
        db.cpCredential.update({ where: { id: credentialId }, data: { lastUsedAt: now } }),
      );
    } catch {
      // Usage timestamps are advisory; a failed write must not fail an authorized request.
    }
  }
}

function denialMessage(code: string): string {
  switch (code) {
    case "CREDENTIAL_REVOKED":
      return "This application credential has been revoked";
    case "CREDENTIAL_EXPIRED":
      return "This application credential has expired";
    case "CREDENTIAL_ENVIRONMENT_MISMATCH":
      return "Invalid application credential";
    case "ACTION_NOT_CATALOGED":
      return "This route is not available to application credentials";
    case "CAPABILITY_NOT_ENABLED":
      return "This capability is not enabled for the application's environment";
    case "API_NOT_AVAILABLE":
      return "This API is not available in the application's environment";
    case "ACTION_NOT_GRANTED":
      return "The application has not been granted this action";
    default:
      return "The application's organization, project, environment or application is not active";
  }
}
