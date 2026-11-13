// Administrative use cases of the control plane: projects, environments, capabilities,
// applications, grants and credentials. Every query is scoped by the full ownership path from
// the organization down, so an ID from another organization or environment resolves to 404.

import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@shared/errors";
import { isCatalogedAction, isKnownCapability, listCapabilities } from "./capability-catalog";
import { generateApplicationCredential, newResourceId } from "./application-credential";
import type { EnvironmentKind } from "./control-plane.types";
import { withTenant, type TenantDb } from "./tenant-transaction";
import { assertMerchantBinding } from "./merchant-binding";

const DEFAULT_CREDENTIAL_LIFETIME_DAYS = 90;

export interface EnvironmentScope {
  organizationId: string;
  projectId: string;
  environmentKind: EnvironmentKind;
}

type ScopedEnvironment = { id: string; organizationId: string; projectId: string; kind: EnvironmentKind; status: string };

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
    const projectId = newResourceId("prj");
    const environmentId = newResourceId("env");
    const project = await this.uniqueOrConflict(`Project slug '${input.slug}' is already used`, () =>
      this.tenant(organizationId, async (db) => {
        const organization = await db.organization.findUnique({ where: { id: organizationId } });
        if (!organization) throw new NotFoundError(`Organization '${organizationId}' was not found`);
        if (organization.status !== "active") {
          throw new AppError("Organization is not active", 409, "ORGANIZATION_INACTIVE");
        }
        const created = await db.cpProject.create({
          data: { id: projectId, organizationId, slug: input.slug, name: input.name, createdBy: actor },
        });
        await db.cpEnvironment.create({
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
    return this.tenant(organizationId, (db) =>
      db.cpProject.findMany({
        where: { organizationId },
        orderBy: { createdAt: "asc" },
      }),
    );
  }

  async getProject(organizationId: string, projectId: string) {
    const { project, environments, capabilities } = await this.tenant(organizationId, async (db) => {
      const project = await db.cpProject.findFirst({ where: { id: projectId, organizationId } });
      if (!project) throw new NotFoundError(`Project '${projectId}' was not found`);
      const environments = await db.cpEnvironment.findMany({
        where: { organizationId, projectId },
        orderBy: { kind: "desc" },
      });
      const capabilities = await db.cpCapabilityInstallation.findMany({
        where: { organizationId, projectId },
      });
      return { project, environments, capabilities };
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
    if (capability === "payments" && enabled) assertMerchantBinding(scope.organizationId);
    const status = enabled ? "enabled" : "disabled";
    const { environment, installation } = await this.tenant(scope.organizationId, async (db) => {
      const environment = await this.resolveEnvironment(db, scope);
      const installation = await db.cpCapabilityInstallation.upsert({
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
      return { environment, installation };
    });
    await this.recordAudit(`control_plane.capability.${status}`, actor, "cp_capability", `${environment.id}:${capability}`, environment.kind, {
      projectId: environment.projectId,
    });
    return { capability: installation.capability, status: installation.status };
  }

  // ── Applications ─────────────────────────────────────────────────────────

  async createApplication(scope: EnvironmentScope, input: { slug: string; name: string }, actor: string) {
    const { environment, application } = await this.uniqueOrConflict(`Application slug '${input.slug}' is already used in this environment`, () =>
      this.tenant(scope.organizationId, async (db) => {
        const environment = await this.resolveEnvironment(db, scope);
        const application = await db.cpApplication.create({
        data: {
          id: newResourceId("app"),
          organizationId: environment.organizationId,
          projectId: environment.projectId,
          environmentId: environment.id,
          slug: input.slug,
          name: input.name,
          createdBy: actor,
        },
        });
        return { environment, application };
      }),
    );
    await this.recordAudit("control_plane.application.created", actor, "cp_application", application.id, environment.kind, {
      projectId: environment.projectId,
      slug: application.slug,
    });
    return toApplicationView(application);
  }

  async listApplications(scope: EnvironmentScope) {
    const applications = await this.tenant(scope.organizationId, async (db) => {
      const environment = await this.resolveEnvironment(db, scope);
      return db.cpApplication.findMany({
        where: { environmentId: environment.id, projectId: environment.projectId, organizationId: environment.organizationId },
        orderBy: { createdAt: "asc" },
      });
    });
    return applications.map(toApplicationView);
  }

  // ── Grants ───────────────────────────────────────────────────────────────

  /** Grants one catalogued action. Granting an already active action returns the existing grant. */
  async grant(scope: EnvironmentScope, applicationId: string, input: { capability: string; action: string }, actor: string) {
    if (!isCatalogedAction(input.capability, input.action)) {
      throw new ValidationError(`'${input.action}' is not an action of capability '${input.capability}'`);
    }
    const target = { targetKind: "capability", targetId: input.capability, action: input.action };
    const outcome = await this.uniqueOrConflict("This action is already granted", () =>
      this.tenant(scope.organizationId, async (db) => {
        const application = await this.resolveApplication(db, scope, applicationId);
        const existing = await db.cpApplicationGrant.findFirst({
          where: { applicationId: application.id, ...target, status: "active" },
        });
        if (existing) return { grant: existing, created: false };
        const grant = await db.cpApplicationGrant.create({
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
        await db.cpApplication.update({ where: { id: application.id }, data: { authorizationVersion: { increment: 1 } } });
        return { grant, created: true };
      }),
    );
    if (outcome.created) {
      await this.recordAudit("control_plane.grant.created", actor, "cp_application_grant", outcome.grant.id, scope.environmentKind, {
        applicationId,
        action: outcome.grant.action,
      });
    }
    return toGrantView(outcome.grant);
  }

  async listGrants(scope: EnvironmentScope, applicationId: string) {
    const grants = await this.tenant(scope.organizationId, async (db) => {
      const application = await this.resolveApplication(db, scope, applicationId);
      return db.cpApplicationGrant.findMany({
        where: { applicationId: application.id, environmentId: application.environmentId, organizationId: application.organizationId },
        orderBy: { createdAt: "asc" },
      });
    });
    return grants.map(toGrantView);
  }

  async revokeGrant(scope: EnvironmentScope, applicationId: string, grantId: string, actor: string) {
    const outcome = await this.tenant(scope.organizationId, async (db) => {
      const application = await this.resolveApplication(db, scope, applicationId);
      const grant = await db.cpApplicationGrant.findFirst({
        where: { id: grantId, applicationId: application.id, organizationId: application.organizationId },
      });
      if (!grant) throw new NotFoundError(`Grant '${grantId}' was not found`);
      if (grant.status === "revoked") return { grant, changed: false };
      const updated = await db.cpApplicationGrant.update({
        where: { id: grant.id },
        data: { status: "revoked", revokedAt: new Date(), revokedBy: actor },
      });
      await db.cpApplication.update({ where: { id: application.id }, data: { authorizationVersion: { increment: 1 } } });
      return { grant: updated, changed: true };
    });
    if (outcome.changed) {
      await this.recordAudit("control_plane.grant.revoked", actor, "cp_application_grant", grantId, scope.environmentKind, {
        applicationId,
        action: outcome.grant.action,
      });
    }
    return toGrantView(outcome.grant);
  }

  // ── Credentials ──────────────────────────────────────────────────────────

  /**
   * Issues an application credential and returns its plaintext exactly once. The operationId
   * makes a retry safe: the same request returns CREDENTIAL_ALREADY_ISSUED without minting or
   * revealing anything, and a different request under the same ID is a mismatch. Live credentials
   * need an activated live environment.
   */
  async issueCredential(
    scope: EnvironmentScope,
    applicationId: string,
    input: { operationId: string; expiresInDays?: number },
    actor: string,
  ) {
    const lifetimeDays = input.expiresInDays ?? DEFAULT_CREDENTIAL_LIFETIME_DAYS;
    const generated = generateApplicationCredential(scope.environmentKind);
    const credentialId = newResourceId("crd");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + lifetimeDays * 24 * 60 * 60 * 1000);

    const outcome = await this.tenant(scope.organizationId, async (db) => {
      const environment = await this.resolveEnvironment(db, scope);
      if (environment.kind === "live" && environment.status !== "active") {
        throw new AppError("The live environment must be activated before live credentials can be issued", 409, "LIVE_ENVIRONMENT_NOT_ACTIVE");
      }
      const application = await this.resolveApplication(db, scope, applicationId);
      if (application.status !== "active") throw new AppError("Application is not active", 409, "APPLICATION_INACTIVE");
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ action: "issue", organizationId: application.organizationId, applicationId: application.id, lifetimeDays }))
        .digest("hex");

      // Serializes concurrent retries of one operation without holding row locks on credentials.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.operationId}, 0))`;
      const receipt = await db.cpCredentialOperation.findUnique({ where: { operationId: input.operationId } });
      if (receipt) {
        return receipt.fingerprint === fingerprint
          ? ({ kind: "replayed", credentialId: receipt.credentialId } as const)
          : ({ kind: "mismatch" } as const);
      }
      await db.cpCredential.create({
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
      await db.cpCredentialOperation.create({
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
      applicationId,
      lookupPrefix: generated.lookupPrefix,
      expiresAt: expiresAt.toISOString(),
    });
    return {
      id: credentialId,
      applicationId,
      environment: scope.environmentKind,
      lookupPrefix: generated.lookupPrefix,
      expiresAt: expiresAt.toISOString(),
      /** Shown once. Only a verifier is stored. */
      secret: generated.plaintext,
    };
  }

  async listCredentials(scope: EnvironmentScope, applicationId: string) {
    const credentials = await this.tenant(scope.organizationId, async (db) => {
      const application = await this.resolveApplication(db, scope, applicationId);
      return db.cpCredential.findMany({
        where: { applicationId: application.id, environmentId: application.environmentId, organizationId: application.organizationId },
        orderBy: { createdAt: "asc" },
      });
    });
    return credentials.map(toCredentialView);
  }

  async revokeCredential(scope: EnvironmentScope, applicationId: string, credentialId: string, reason: string, actor: string) {
    const outcome = await this.tenant(scope.organizationId, async (db) => {
      const application = await this.resolveApplication(db, scope, applicationId);
      const credential = await db.cpCredential.findFirst({
        where: { id: credentialId, applicationId: application.id, organizationId: application.organizationId },
      });
      if (!credential) throw new NotFoundError(`Credential '${credentialId}' was not found`);
      if (credential.status === "revoked") return { credential, changed: false };
      const revoked = await db.cpCredential.update({
        where: { id: credential.id },
        data: { status: "revoked", revokedAt: new Date(), revokedBy: actor, revokedReason: reason },
      });
      return { credential: revoked, changed: true };
    });
    if (outcome.changed) {
      await this.recordAudit("control_plane.credential.revoked", actor, "cp_credential", credentialId, scope.environmentKind, {
        applicationId,
        reason,
      });
    }
    return toCredentialView(outcome.credential);
  }

  // ── Scoping helpers ──────────────────────────────────────────────────────

  private tenant<T>(organizationId: string, work: (db: TenantDb) => Promise<T>): Promise<T> {
    return withTenant(this.prisma, { organizationId }, work);
  }

  private async resolveEnvironment(db: TenantDb, scope: EnvironmentScope): Promise<ScopedEnvironment> {
    const environment = await db.cpEnvironment.findFirst({
      where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
    });
    if (!environment) {
      throw new NotFoundError(`Project '${scope.projectId}' has no ${scope.environmentKind} environment`);
    }
    return { ...environment, kind: environment.kind as EnvironmentKind };
  }

  private async resolveApplication(db: TenantDb, scope: EnvironmentScope, applicationId: string) {
    const environment = await this.resolveEnvironment(db, scope);
    const application = await db.cpApplication.findFirst({
      where: { id: applicationId, environmentId: environment.id, projectId: environment.projectId, organizationId: environment.organizationId },
    });
    if (!application) throw new NotFoundError(`Application '${applicationId}' was not found in this environment`);
    return application;
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
