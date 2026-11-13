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

type Target =
  | { kind: "capability"; capability: string; action: (db: TenantDb) => Promise<string | undefined> | string | undefined }
  | { kind: "api"; apiId: string; method: string; relativePath: string };

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

  /** Records how an admitted request ended, for usage reporting. */
  async recordOutcome(call: AuthorizedCapabilityCall, statusCode: number): Promise<void> {
    await this.quota.complete(call.identity, call.requestKey, statusCode);
  }

  private async authorizeTarget(
    request: { bearer: string; requestId: string; idempotencyKey?: string },
    target: Target,
    now: Date,
  ): Promise<AuthorizedCapabilityCall & { upstreamUrl?: string }> {
    const parsed = parseApplicationCredential(request.bearer);
    if (!parsed) throw new UnauthorizedError("Invalid application credential");

    const organizationId = await credentialOrganization(this.prisma, parsed.lookupPrefix);
    if (!organizationId) throw new UnauthorizedError("Invalid application credential");

    const loaded = await withTenant(this.prisma, { organizationId }, async (db) => {
      const credential = await db.cpCredential.findUnique({ where: { lookupPrefix: parsed.lookupPrefix } });
      if (!credential || !credentialMatches(request.bearer, credential.verifierSha256)) return undefined;
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
    if (!loaded) throw new UnauthorizedError("Invalid application credential");
    const { credential, scope, organization, project, environment, application, grants, ownerMapping, resolved } = loaded;
    // Composite foreign keys make these impossible; treat a gap as an invalid credential.
    if (!organization || !project || !environment || !application) {
      throw new UnauthorizedError("Invalid application credential");
    }

    const decision = decideCapabilityAccess({
      now,
      presentedKind: parsed.environmentKind,
      organizationStatus: organization.status,
      project,
      environment: { kind: environment.kind as EnvironmentKind, status: environment.status },
      application,
      credential: {
        status: credential.status,
        expiresAt: credential.expiresAt,
        environmentKind: credential.environmentKind as EnvironmentKind,
      },
      targetKind: target.kind,
      capability: resolved ? { id: resolved.id, status: resolved.status } : undefined,
      action: resolved?.action,
      grants,
    });
    if (!decision.allowed) {
      const status = decision.denial.kind === "authentication" ? 401 : 403;
      throw new AppError(denialMessage(decision.denial.code), status, decision.denial.code);
    }

    const usageTarget = target.kind === "api" ? `api:${target.apiId}` : target.capability;
    if (usageTarget === "payments") assertMerchantBinding(scope.organizationId);
    await this.touchLastUsed(credential.organizationId, credential.id, credential.lastUsedAt, now);

    const identity: ApplicationIdentity = {
      ...scope,
      environmentKind: environment.kind as EnvironmentKind,
      applicationId: application.id,
      credentialId: credential.id,
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
