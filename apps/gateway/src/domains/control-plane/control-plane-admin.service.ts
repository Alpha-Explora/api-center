// Administrative use cases of the control plane: projects, environments, capabilities,
// applications, grants and credentials. Every query is scoped by the full ownership path from
// the organization down, so an ID from another organization or environment resolves to 404.

import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { AppError, ConflictError, NotFoundError, ServiceUnavailableError, ValidationError } from "@shared/errors";
import { isCatalogedAction, isKnownCapability, listCapabilities } from "./capability-catalog";
import { generateApplicationCredential, newResourceId } from "./application-credential";
import type { EnvironmentKind } from "./control-plane.types";

const DEFAULT_CREDENTIAL_LIFETIME_DAYS = 90;

export interface EnvironmentScope {
  organizationId: string;
  projectId: string;
  environmentKind: EnvironmentKind;
}

type ScopedEnvironment = { id: string; organizationId: string; projectId: string; kind: EnvironmentKind };

@Injectable()
export class ControlPlaneAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventsService,
  ) {}

  listCapabilities() {
    return listCapabilities();
  }

  // ── Projects ─────────────────────────────────────────────────────────────

  /** Creates a project and its test environment. Live environments are provisioned separately. */
  async createProject(organizationId: string, input: { slug: string; name: string }, actor: string) {
    this.requireDatabase();
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundError(`Organization '${organizationId}' was not found`);
    if (organization.status !== "active") {
      throw new AppError("Organization is not active", 409, "ORGANIZATION_INACTIVE");
    }

    const projectId = newResourceId("prj");
    const environmentId = newResourceId("env");
    const project = await this.uniqueOrConflict(`Project slug '${input.slug}' is already used`, () =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.cpProject.create({
          data: { id: projectId, organizationId, slug: input.slug, name: input.name, createdBy: actor },
        });
        await tx.cpEnvironment.create({
          data: { id: environmentId, organizationId, projectId, kind: "test" },
        });
        return created;
      }),
    );
    await this.recordAudit("control_plane.project.created", actor, "cp_project", project.id, "test", {
      organizationId,
      slug: project.slug,
    });
    return this.getProject(organizationId, project.id);
  }

  async listProjects(organizationId: string) {
    this.requireDatabase();
    return this.prisma.cpProject.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
  }

  async getProject(organizationId: string, projectId: string) {
    this.requireDatabase();
    const project = await this.prisma.cpProject.findFirst({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundError(`Project '${projectId}' was not found`);
    const environments = await this.prisma.cpEnvironment.findMany({
      where: { organizationId, projectId },
      orderBy: { kind: "desc" },
    });
    const capabilities = await this.prisma.cpCapabilityInstallation.findMany({
      where: { organizationId, projectId },
    });
    return {
      ...project,
      environments: environments.map((environment) => ({
        id: environment.id,
        kind: environment.kind,
        status: environment.status,
        capabilities: capabilities
          .filter((installation) => installation.environmentId === environment.id)
          .map(({ capability, status }) => ({ capability, status })),
      })),
    };
  }

  // ── Capabilities ─────────────────────────────────────────────────────────

  /** Enabling a capability creates its environment configuration. It grants no application access. */
  async setCapability(scope: EnvironmentScope, capability: string, enabled: boolean, actor: string) {
    if (!isKnownCapability(capability)) throw new NotFoundError(`Capability '${capability}' is not available`);
    const environment = await this.resolveEnvironment(scope);
    const status = enabled ? "enabled" : "disabled";
    const installation = await this.prisma.cpCapabilityInstallation.upsert({
      where: { environmentId_capability: { environmentId: environment.id, capability } },
      create: {
        organizationId: environment.organizationId,
        projectId: environment.projectId,
        environmentId: environment.id,
        capability,
        status,
        createdBy: actor,
      },
      update: { status },
    });
    await this.recordAudit(`control_plane.capability.${status}`, actor, "cp_capability", `${environment.id}:${capability}`, environment.kind, {
      projectId: environment.projectId,
    });
    return { capability: installation.capability, status: installation.status };
  }

  // ── Applications ─────────────────────────────────────────────────────────

  async createApplication(scope: EnvironmentScope, input: { slug: string; name: string }, actor: string) {
    const environment = await this.resolveEnvironment(scope);
    const application = await this.uniqueOrConflict(`Application slug '${input.slug}' is already used in this environment`, () =>
      this.prisma.cpApplication.create({
        data: {
          id: newResourceId("app"),
          organizationId: environment.organizationId,
          projectId: environment.projectId,
          environmentId: environment.id,
          slug: input.slug,
          name: input.name,
          createdBy: actor,
        },
      }),
    );
    await this.recordAudit("control_plane.application.created", actor, "cp_application", application.id, environment.kind, {
      projectId: environment.projectId,
      slug: application.slug,
    });
    return toApplicationView(application);
  }

  async listApplications(scope: EnvironmentScope) {
    const environment = await this.resolveEnvironment(scope);
    const applications = await this.prisma.cpApplication.findMany({
      where: { environmentId: environment.id, projectId: environment.projectId, organizationId: environment.organizationId },
      orderBy: { createdAt: "asc" },
    });
    return applications.map(toApplicationView);
  }

  // ── Grants ───────────────────────────────────────────────────────────────

  /** Grants one catalogued action. Granting an already active action returns the existing grant. */
  async grant(scope: EnvironmentScope, applicationId: string, input: { capability: string; action: string }, actor: string) {
    if (!isCatalogedAction(input.capability, input.action)) {
      throw new ValidationError(`'${input.action}' is not an action of capability '${input.capability}'`);
    }
    const application = await this.resolveApplication(scope, applicationId);
    const target = { targetKind: "capability", targetId: input.capability, action: input.action };

    const existing = await this.prisma.cpApplicationGrant.findFirst({
      where: { applicationId: application.id, ...target, status: "active" },
    });
    if (existing) return toGrantView(existing);

    const grant = await this.uniqueOrConflict("This action is already granted", () =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.cpApplicationGrant.create({
          data: {
            id: newResourceId("grt"),
            organizationId: application.organizationId,
            projectId: application.projectId,
            environmentId: application.environmentId,
            applicationId: application.id,
            ...target,
            createdBy: actor,
          },
        });
        await tx.cpApplication.update({
          where: { id: application.id },
          data: { authorizationVersion: { increment: 1 } },
        });
        return created;
      }),
    );
    await this.recordAudit("control_plane.grant.created", actor, "cp_application_grant", grant.id, scope.environmentKind, {
      applicationId: application.id,
      action: grant.action,
    });
    return toGrantView(grant);
  }

  async listGrants(scope: EnvironmentScope, applicationId: string) {
    const application = await this.resolveApplication(scope, applicationId);
    const grants = await this.prisma.cpApplicationGrant.findMany({
      where: { applicationId: application.id, environmentId: application.environmentId, organizationId: application.organizationId },
      orderBy: { createdAt: "asc" },
    });
    return grants.map(toGrantView);
  }

  async revokeGrant(scope: EnvironmentScope, applicationId: string, grantId: string, actor: string) {
    const application = await this.resolveApplication(scope, applicationId);
    const grant = await this.prisma.cpApplicationGrant.findFirst({
      where: { id: grantId, applicationId: application.id, organizationId: application.organizationId },
    });
    if (!grant) throw new NotFoundError(`Grant '${grantId}' was not found`);
    if (grant.status === "revoked") return toGrantView(grant);

    const revoked = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.cpApplicationGrant.update({
        where: { id: grant.id },
        data: { status: "revoked", revokedAt: new Date(), revokedBy: actor },
      });
      await tx.cpApplication.update({
        where: { id: application.id },
        data: { authorizationVersion: { increment: 1 } },
      });
      return updated;
    });
    await this.recordAudit("control_plane.grant.revoked", actor, "cp_application_grant", grant.id, scope.environmentKind, {
      applicationId: application.id,
      action: grant.action,
    });
    return toGrantView(revoked);
  }

  // ── Credentials ──────────────────────────────────────────────────────────

  /**
   * Issues an application credential and returns its plaintext exactly once. The operationId
   * makes a retry safe: the same request returns CREDENTIAL_ALREADY_ISSUED without minting or
   * revealing anything, and a different request under the same ID is a mismatch.
   */
  async issueCredential(
    scope: EnvironmentScope,
    applicationId: string,
    input: { operationId: string; expiresInDays?: number },
    actor: string,
  ) {
    if (scope.environmentKind !== "test") {
      throw new AppError("Live credentials are not available until live provisioning is delivered", 409, "LIVE_CREDENTIALS_UNAVAILABLE");
    }
    const application = await this.resolveApplication(scope, applicationId);
    if (application.status !== "active") throw new AppError("Application is not active", 409, "APPLICATION_INACTIVE");

    const lifetimeDays = input.expiresInDays ?? DEFAULT_CREDENTIAL_LIFETIME_DAYS;
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ action: "issue", organizationId: application.organizationId, applicationId: application.id, lifetimeDays }))
      .digest("hex");
    const generated = generateApplicationCredential(scope.environmentKind);
    const credentialId = newResourceId("crd");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + lifetimeDays * 24 * 60 * 60 * 1000);

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Serializes concurrent retries of one operation without holding row locks on credentials.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.operationId}, 0))`;
      const receipt = await tx.cpCredentialOperation.findUnique({ where: { operationId: input.operationId } });
      if (receipt) {
        return receipt.fingerprint === fingerprint
          ? ({ kind: "replayed", credentialId: receipt.credentialId } as const)
          : ({ kind: "mismatch" } as const);
      }
      await tx.cpCredential.create({
        data: {
          id: credentialId,
          organizationId: application.organizationId,
          projectId: application.projectId,
          environmentId: application.environmentId,
          applicationId: application.id,
          environmentKind: scope.environmentKind,
          lookupPrefix: generated.lookupPrefix,
          verifierSha256: generated.verifierSha256,
          expiresAt,
          createdBy: actor,
          createdAt: now,
        },
      });
      await tx.cpCredentialOperation.create({
        data: { operationId: input.operationId, organizationId: application.organizationId, applicationId: application.id, fingerprint, credentialId },
      });
      return { kind: "issued" } as const;
    });

    if (outcome.kind === "mismatch") {
      throw new AppError("This operationId was already used for a different request", 409, "CREDENTIAL_OPERATION_MISMATCH");
    }
    if (outcome.kind === "replayed") {
      throw new AppError(
        `Credential ${outcome.credentialId} was already issued for this operationId; its secret cannot be shown again`,
        409,
        "CREDENTIAL_ALREADY_ISSUED",
      );
    }

    await this.recordAudit("control_plane.credential.issued", actor, "cp_credential", credentialId, scope.environmentKind, {
      applicationId: application.id,
      lookupPrefix: generated.lookupPrefix,
      expiresAt: expiresAt.toISOString(),
    });
    return {
      id: credentialId,
      applicationId: application.id,
      environment: scope.environmentKind,
      lookupPrefix: generated.lookupPrefix,
      expiresAt: expiresAt.toISOString(),
      /** Shown once. Only a verifier is stored. */
      secret: generated.plaintext,
    };
  }

  async listCredentials(scope: EnvironmentScope, applicationId: string) {
    const application = await this.resolveApplication(scope, applicationId);
    const credentials = await this.prisma.cpCredential.findMany({
      where: { applicationId: application.id, environmentId: application.environmentId, organizationId: application.organizationId },
      orderBy: { createdAt: "asc" },
    });
    return credentials.map(toCredentialView);
  }

  async revokeCredential(scope: EnvironmentScope, applicationId: string, credentialId: string, reason: string, actor: string) {
    const application = await this.resolveApplication(scope, applicationId);
    const credential = await this.prisma.cpCredential.findFirst({
      where: { id: credentialId, applicationId: application.id, organizationId: application.organizationId },
    });
    if (!credential) throw new NotFoundError(`Credential '${credentialId}' was not found`);
    if (credential.status === "revoked") return toCredentialView(credential);

    const revoked = await this.prisma.cpCredential.update({
      where: { id: credential.id },
      data: { status: "revoked", revokedAt: new Date(), revokedBy: actor, revokedReason: reason },
    });
    await this.recordAudit("control_plane.credential.revoked", actor, "cp_credential", credential.id, scope.environmentKind, {
      applicationId: application.id,
      reason,
    });
    return toCredentialView(revoked);
  }

  // ── Scoping helpers ──────────────────────────────────────────────────────

  private async resolveEnvironment(scope: EnvironmentScope): Promise<ScopedEnvironment> {
    this.requireDatabase();
    const environment = await this.prisma.cpEnvironment.findFirst({
      where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
    });
    if (!environment) {
      throw new NotFoundError(`Project '${scope.projectId}' has no ${scope.environmentKind} environment`);
    }
    return { ...environment, kind: environment.kind as EnvironmentKind };
  }

  private async resolveApplication(scope: EnvironmentScope, applicationId: string) {
    const environment = await this.resolveEnvironment(scope);
    const application = await this.prisma.cpApplication.findFirst({
      where: { id: applicationId, environmentId: environment.id, projectId: environment.projectId, organizationId: environment.organizationId },
    });
    if (!application) throw new NotFoundError(`Application '${applicationId}' was not found in this environment`);
    return application;
  }

  private requireDatabase(): void {
    if (process.env.DATABASE_ENABLED !== "true" && !process.env.DATABASE_URL) {
      throw new ServiceUnavailableError("The control plane requires the APICenter database");
    }
  }

  private async uniqueOrConflict<T>(message: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError(message);
      }
      throw error;
    }
  }

  private async recordAudit(
    type: string,
    actor: string,
    resourceType: string,
    resourceId: string,
    environment: string,
    payload: Record<string, unknown>,
  ) {
    await this.audit.record({
      type,
      actionFamily: type.includes("credential") ? "secret" : "registration",
      actor,
      resourceType,
      resourceId,
      environment,
      severity: "info",
      message: type.replaceAll(".", " "),
      payload,
    });
  }
}

function toApplicationView(application: {
  id: string;
  slug: string;
  name: string;
  status: string;
  projectId: string;
  environmentId: string;
  createdAt: Date;
}) {
  const { id, slug, name, status, projectId, environmentId, createdAt } = application;
  return { id, slug, name, status, projectId, environmentId, createdAt };
}

function toGrantView(grant: {
  id: string;
  applicationId: string;
  targetKind: string;
  targetId: string;
  action: string;
  status: string;
  provenance: string;
  createdAt: Date;
  revokedAt: Date | null;
}) {
  const { id, applicationId, targetId, action, status, provenance, createdAt, revokedAt } = grant;
  return { id, applicationId, capability: targetId, action, status, provenance, createdAt, revokedAt };
}

function toCredentialView(credential: {
  id: string;
  applicationId: string;
  environmentKind: string;
  lookupPrefix: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
}) {
  const { id, applicationId, environmentKind, lookupPrefix, status, expiresAt, createdAt, lastUsedAt, revokedAt, revokedReason } = credential;
  return { id, applicationId, environment: environmentKind, lookupPrefix, status, expiresAt, createdAt, lastUsedAt, revokedAt, revokedReason };
}
