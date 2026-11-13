// Authenticates an application credential and authorizes one capability request. Identity comes
// from the stored credential row alone; nothing the client sends selects the organization,
// project, environment or application. Reads authoritative state on every request (no cache),
// so revocation and grant removal take effect immediately.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { AppError, UnauthorizedError } from "@shared/errors";
import { credentialOrganization, withTenant } from "./tenant-transaction";
import { credentialMatches, parseApplicationCredential } from "./application-credential";
import { decideCapabilityAccess } from "./capability-access.policy";
import { isCatalogedAction, resolveCapabilityAction } from "./capability-catalog";
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

@Injectable()
export class ApplicationAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: RuntimeContextSigner,
    private readonly quota: QuotaService,
  ) {}

  /** Authorizes a request on a capability route; the route maps to its catalogued action. */
  async authorize(request: CapabilityRequest, now = new Date()): Promise<AuthorizedCapabilityCall> {
    return this.authorizeResolved(request, resolveCapabilityAction(request.capability, request.method, request.relativePath), now);
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
    return this.authorizeResolved({ ...request, method: "", relativePath: "" }, action, now);
  }

  private async authorizeResolved(request: CapabilityRequest, action: string | undefined, now: Date): Promise<AuthorizedCapabilityCall> {
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
      const [organization, project, environment, application, capability, grants, ownerMapping] = await Promise.all([
        db.organization.findUnique({ where: { id: scope.organizationId }, select: { status: true } }),
        db.cpProject.findFirst({ where: { id: scope.projectId, organizationId: scope.organizationId } }),
        db.cpEnvironment.findFirst({ where: { id: scope.environmentId, ...pick(scope, "organizationId", "projectId") } }),
        db.cpApplication.findFirst({ where: { id: credential.applicationId, ...scope } }),
        db.cpCapabilityInstallation.findFirst({ where: { capability: request.capability, ...scope } }),
        db.cpApplicationGrant.findMany({
          where: { applicationId: credential.applicationId, ...scope, status: "active" },
          select: { targetKind: true, targetId: true, action: true, status: true },
        }),
        db.cpResourceOwnerMapping.findFirst({
          where: { organizationId: scope.organizationId, projectId: scope.projectId, environmentKind: credential.environmentKind },
        }),
      ]);
      return { credential, scope, organization, project, environment, application, capability, grants, ownerMapping };
    });
    if (!loaded) throw new UnauthorizedError("Invalid application credential");
    const { credential, scope, organization, project, environment, application, capability, grants, ownerMapping } = loaded;
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
      capability: capability ? { id: capability.capability, status: capability.status } : undefined,
      action,
      grants,
    });
    if (!decision.allowed) {
      const status = decision.denial.kind === "authentication" ? 401 : 403;
      throw new AppError(denialMessage(decision.denial.code), status, decision.denial.code);
    }

    if (request.capability === "payments") assertMerchantBinding(scope.organizationId);
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
    await this.quota.reserve(identity, request.capability, decision.action, requestKey, now);

    // Records stay scoped to the legacy owner of a migrated project until they are reconciled.
    const resourceOwner = ownerMapping
      ? { groupId: ownerMapping.ownerGroupId, projectId: ownerMapping.ownerProjectId }
      : { groupId: scope.organizationId, projectId: scope.projectId };
    return {
      identity,
      requestKey,
      resourceOwner,
      capability: request.capability,
      action: decision.action,
      signedContext: this.signer.sign({
        identity,
        resourceOwner,
        capability: request.capability,
        action: decision.action,
        requestId: request.requestId,
        now,
      }),
    };
  }

  /** Records how an admitted request ended, for usage reporting. */
  async recordOutcome(call: AuthorizedCapabilityCall, statusCode: number): Promise<void> {
    await this.quota.complete(call.identity, call.requestKey, statusCode);
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

function pick<T extends object, K extends keyof T>(value: T, ...keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
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
    case "ACTION_NOT_GRANTED":
      return "The application has not been granted this action";
    default:
      return "The application's organization, project, environment or application is not active";
  }
}
