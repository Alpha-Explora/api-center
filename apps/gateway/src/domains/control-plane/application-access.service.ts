// Authenticates an application credential and authorizes one capability request. Identity comes
// from the stored credential row alone; nothing the client sends selects the organization,
// project, environment or application. Reads authoritative state on every request (no cache),
// so revocation and grant removal take effect immediately.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { AppError, ServiceUnavailableError, UnauthorizedError } from "@shared/errors";
import { credentialMatches, parseApplicationCredential } from "./application-credential";
import { decideCapabilityAccess } from "./capability-access.policy";
import { resolveCapabilityAction } from "./capability-catalog";
import { RuntimeContextSigner } from "./runtime-context.signer";
import type { ApplicationIdentity, AuthorizedCapabilityCall, EnvironmentKind } from "./control-plane.types";

const LAST_USED_RESOLUTION_MS = 60_000;

export interface CapabilityRequest {
  bearer: string;
  capability: string;
  method: string;
  /** Path relative to the capability root, e.g. `/send`. */
  relativePath: string;
  requestId: string;
}

@Injectable()
export class ApplicationAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: RuntimeContextSigner,
  ) {}

  async authorize(request: CapabilityRequest, now = new Date()): Promise<AuthorizedCapabilityCall> {
    if (process.env.DATABASE_ENABLED !== "true" && !process.env.DATABASE_URL) {
      throw new ServiceUnavailableError("Application credentials require the APICenter database");
    }
    const parsed = parseApplicationCredential(request.bearer);
    if (!parsed) throw new UnauthorizedError("Invalid application credential");

    const credential = await this.prisma.cpCredential.findUnique({ where: { lookupPrefix: parsed.lookupPrefix } });
    if (!credential || !credentialMatches(request.bearer, credential.verifierSha256)) {
      throw new UnauthorizedError("Invalid application credential");
    }

    const scope = {
      organizationId: credential.organizationId,
      projectId: credential.projectId,
      environmentId: credential.environmentId,
    };
    const [organization, project, environment, application, capability, grants] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: scope.organizationId }, select: { status: true } }),
      this.prisma.cpProject.findFirst({ where: { id: scope.projectId, organizationId: scope.organizationId } }),
      this.prisma.cpEnvironment.findFirst({ where: { id: scope.environmentId, ...pick(scope, "organizationId", "projectId") } }),
      this.prisma.cpApplication.findFirst({ where: { id: credential.applicationId, ...scope } }),
      this.prisma.cpCapabilityInstallation.findFirst({ where: { capability: request.capability, ...scope } }),
      this.prisma.cpApplicationGrant.findMany({
        where: { applicationId: credential.applicationId, ...scope, status: "active" },
        select: { targetKind: true, targetId: true, action: true, status: true },
      }),
    ]);
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
      action: resolveCapabilityAction(request.capability, request.method, request.relativePath),
      grants,
    });
    if (!decision.allowed) {
      const status = decision.denial.kind === "authentication" ? 401 : 403;
      throw new AppError(denialMessage(decision.denial.code), status, decision.denial.code);
    }

    await this.touchLastUsed(credential.id, credential.lastUsedAt, now);

    const identity: ApplicationIdentity = {
      ...scope,
      environmentKind: environment.kind as EnvironmentKind,
      applicationId: application.id,
      credentialId: credential.id,
    };
    return {
      identity,
      capability: request.capability,
      action: decision.action,
      signedContext: this.signer.sign({
        identity,
        capability: request.capability,
        action: decision.action,
        requestId: request.requestId,
        now,
      }),
    };
  }

  private async touchLastUsed(credentialId: string, lastUsedAt: Date | null, now: Date) {
    if (lastUsedAt && now.getTime() - lastUsedAt.getTime() < LAST_USED_RESOLUTION_MS) return;
    try {
      await this.prisma.cpCredential.update({ where: { id: credentialId }, data: { lastUsedAt: now } });
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
