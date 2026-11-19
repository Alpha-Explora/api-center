// Publishing APIs and granting applications access to them.
//
// An application in the API's own project can be granted directly. An application in another
// project of the organization gets an access request that the API project's administrators decide.
// Grants never cross organizations or environment kinds.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@shared/errors";
import { assertPublicUpstream, upstreamGuardOptions } from "@shared/proxy/upstream-guard";
import { newResourceId } from "./application-credential";
import { isValidPathPattern } from "./api-operations";
import { withTenant, type TenantDb } from "./tenant-transaction";
import type { EnvironmentScope } from "./control-plane-admin.service";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ACTION_PATTERN = /^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)+$/;

function newId(prefix: "api" | "acr"): string {
  if (prefix === "api") return newResourceId("api");
  let out = "";
  while (out.length < 24) {
    for (const byte of randomBytes(48)) {
      if (byte < 252) out += ALPHABET[byte % 36];
      if (out.length === 24) break;
    }
  }
  return `${prefix}_${out}`;
}

export interface OperationInput {
  method: string;
  path: string;
  action: string;
  description?: string;
}

export interface PublishInput {
  slug: string;
  name: string;
  upstreamUrl: string;
  operations: OperationInput[];
}

@Injectable()
export class PublishedApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventsService,
  ) {}

  async publish(scope: EnvironmentScope, input: PublishInput, actor: string) {
    validateOperations(input.operations);
    await assertPublicUpstream(input.upstreamUrl, upstreamGuardOptions());
    const api = await this.tenant(scope.organizationId, async (db) => {
      const environment = await requireEnvironment(db, scope);
      try {
        const created = await db.cpPublishedApi.create({
          data: {
            id: newId("api"),
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            environmentId: environment.id,
            environmentKind: scope.environmentKind,
            slug: input.slug,
            name: input.name,
            upstreamUrl: input.upstreamUrl,
            createdBy: actor,
          },
        });
        await db.cpPublishedApiOperation.createMany({ data: operationRows(scope.organizationId, created.id, input.operations) });
        return created;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ConflictError(`API slug '${input.slug}' is already used in this environment`);
        }
        throw error;
      }
    });
    await this.recordAudit("control_plane.api.published", actor, api.id, scope.environmentKind, {
      projectId: scope.projectId,
      operations: input.operations.length,
    });
    return this.get(scope.organizationId, api.id);
  }

  async get(organizationId: string, apiId: string) {
    return this.tenant(organizationId, async (db) => {
      const api = await db.cpPublishedApi.findFirst({ where: { id: apiId, organizationId } });
      if (!api) throw new NotFoundError(`API '${apiId}' was not found`);
      const operations = await db.cpPublishedApiOperation.findMany({ where: { apiId, organizationId } });
      return { ...api, operations: operations.map(({ method, pathPattern, action, description }) => ({ method, path: pathPattern, action, description })) };
    });
  }

  async listForEnvironment(scope: EnvironmentScope) {
    const ids = await this.tenant(scope.organizationId, async (db) => {
      const environment = await requireEnvironment(db, scope);
      return (await db.cpPublishedApi.findMany({ where: { organizationId: scope.organizationId, environmentId: environment.id }, select: { id: true } })).map(
        (row) => row.id,
      );
    });
    return Promise.all(ids.map((id) => this.get(scope.organizationId, id)));
  }

  /** The organization's API catalogue for consumers: no upstream URLs. */
  async catalogue(organizationId: string, environmentKind: "test" | "live") {
    return this.tenant(organizationId, async (db) => {
      const apis = await db.cpPublishedApi.findMany({ where: { organizationId, environmentKind, status: "active" }, orderBy: { slug: "asc" } });
      const operations = await db.cpPublishedApiOperation.findMany({ where: { organizationId, apiId: { in: apis.map((api) => api.id) } } });
      return apis.map((api) => ({
        id: api.id,
        projectId: api.projectId,
        slug: api.slug,
        name: api.name,
        environmentKind: api.environmentKind,
        operations: operations
          .filter((operation) => operation.apiId === api.id)
          .map(({ method, pathPattern, action, description }) => ({ method, path: pathPattern, action, description })),
      }));
    });
  }

  async update(organizationId: string, apiId: string, change: { status?: "active" | "disabled"; upstreamUrl?: string; operations?: OperationInput[] }, actor: string) {
    if (change.operations) validateOperations(change.operations);
    if (change.upstreamUrl) await assertPublicUpstream(change.upstreamUrl, upstreamGuardOptions());
    const api = await this.tenant(organizationId, async (db) => {
      const existing = await db.cpPublishedApi.findFirst({ where: { id: apiId, organizationId } });
      if (!existing) throw new NotFoundError(`API '${apiId}' was not found`);
      if (change.operations) {
        await db.cpPublishedApiOperation.deleteMany({ where: { apiId, organizationId } });
        await db.cpPublishedApiOperation.createMany({ data: operationRows(organizationId, apiId, change.operations) });
      }
      return db.cpPublishedApi.update({
        where: { id: apiId },
        data: { ...(change.status ? { status: change.status } : {}), ...(change.upstreamUrl ? { upstreamUrl: change.upstreamUrl } : {}) },
      });
    });
    await this.recordAudit("control_plane.api.updated", actor, apiId, api.environmentKind, {
      ...(change.status ? { status: change.status } : {}),
      upstreamChanged: Boolean(change.upstreamUrl),
      ...(change.operations ? { operations: change.operations.length } : {}),
    });
    return this.get(organizationId, apiId);
  }

  async apiProjectId(organizationId: string, apiId: string): Promise<string> {
    return (await this.get(organizationId, apiId)).projectId;
  }

  /**
   * Grants an application an API action. Same project: granted now. Another project: a pending
   * access request for the API project's administrators.
   */
  async requestAccess(consumer: EnvironmentScope, applicationId: string, apiId: string, action: string, actor: string) {
    const outcome = await this.tenant(consumer.organizationId, async (db) => {
      const environment = await requireEnvironment(db, consumer);
      const application = await db.cpApplication.findFirst({
        where: { id: applicationId, organizationId: consumer.organizationId, projectId: consumer.projectId, environmentId: environment.id },
      });
      if (!application) throw new NotFoundError(`Application '${applicationId}' was not found in this environment`);
      const api = await db.cpPublishedApi.findFirst({ where: { id: apiId, organizationId: consumer.organizationId } });
      if (!api || api.environmentKind !== consumer.environmentKind) {
        throw new NotFoundError(`API '${apiId}' is not available in the ${consumer.environmentKind} environment`);
      }
      const declared = await db.cpPublishedApiOperation.count({ where: { apiId, organizationId: consumer.organizationId, action } });
      if (declared === 0) throw new ValidationError(`'${action}' is not an action of API '${apiId}'`);

      if (api.projectId === consumer.projectId) {
        const grant = await createApiGrant(db, application, apiId, action, actor);
        return { kind: "granted" as const, grant };
      }
      const pending = await db.cpApiAccessRequest.findFirst({
        where: { organizationId: consumer.organizationId, apiId, action, consumerApplicationId: applicationId, status: "pending" },
      });
      if (pending) return { kind: "requested" as const, request: pending };
      const request = await db.cpApiAccessRequest.create({
        data: {
          id: newId("acr"),
          organizationId: consumer.organizationId,
          apiId,
          action,
          consumerProjectId: consumer.projectId,
          consumerEnvironmentId: environment.id,
          consumerApplicationId: applicationId,
          requestedBy: actor,
        },
      });
      return { kind: "requested" as const, request };
    });
    await this.recordAudit(`control_plane.api_access.${outcome.kind}`, actor, apiId, consumer.environmentKind, { applicationId, action });
    return outcome;
  }

  async listAccessRequests(organizationId: string, apiProjectId: string) {
    return this.tenant(organizationId, async (db) => {
      const apiIds = (await db.cpPublishedApi.findMany({ where: { organizationId, projectId: apiProjectId }, select: { id: true } })).map((row) => row.id);
      if (apiIds.length === 0) return [];
      return db.cpApiAccessRequest.findMany({ where: { organizationId, apiId: { in: apiIds } }, orderBy: { createdAt: "desc" } });
    });
  }

  async accessRequestApiProject(organizationId: string, requestId: string): Promise<string> {
    return this.tenant(organizationId, async (db) => {
      const request = await db.cpApiAccessRequest.findFirst({ where: { id: requestId, organizationId } });
      if (!request) throw new NotFoundError(`Access request '${requestId}' was not found`);
      const api = await db.cpPublishedApi.findFirst({ where: { id: request.apiId, organizationId } });
      if (!api) throw new NotFoundError(`API '${request.apiId}' was not found`);
      return api.projectId;
    });
  }

  async decide(organizationId: string, requestId: string, approve: boolean, actor: string) {
    const decided = await this.tenant(organizationId, async (db) => {
      const request = await db.cpApiAccessRequest.findFirst({ where: { id: requestId, organizationId } });
      if (!request) throw new NotFoundError(`Access request '${requestId}' was not found`);
      if (request.status !== "pending") throw new AppError(`Access request is already ${request.status}`, 409, "ACCESS_REQUEST_DECIDED");
      if (request.requestedBy === actor) throw new AppError("An access request cannot be decided by its requester", 403, "SELF_APPROVAL");
      let grantId: string | null = null;
      if (approve) {
        const application = await db.cpApplication.findFirst({
          where: { id: request.consumerApplicationId, organizationId, environmentId: request.consumerEnvironmentId },
        });
        if (!application) throw new NotFoundError("The requesting application no longer exists");
        grantId = (await createApiGrant(db, application, request.apiId, request.action, actor)).id;
      }
      return db.cpApiAccessRequest.update({
        where: { id: requestId },
        data: { status: approve ? "approved" : "rejected", decidedBy: actor, decidedAt: new Date(), grantId },
      });
    });
    await this.recordAudit(`control_plane.api_access.${decided.status}`, actor, decided.apiId, "", { requestId, action: decided.action });
    return decided;
  }

  private tenant<T>(organizationId: string, work: (db: TenantDb) => Promise<T>): Promise<T> {
    return withTenant(this.prisma, { organizationId }, work);
  }

  private async recordAudit(type: string, actor: string, resourceId: string, environment: string, payload: Record<string, unknown>) {
    await this.audit.record({
      type,
      actionFamily: "registration",
      actor,
      resourceType: "cp_published_api",
      resourceId,
      ...(environment ? { environment } : {}),
      severity: "info",
      message: type.replaceAll(".", " "),
      payload,
    });
  }
}

function validateOperations(operations: OperationInput[]) {
  if (operations.length === 0) throw new ValidationError("An API needs at least one operation");
  const seen = new Set<string>();
  for (const operation of operations) {
    const method = operation.method.toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new ValidationError(`Method '${operation.method}' is not supported`);
    if (!isValidPathPattern(operation.path)) throw new ValidationError(`Path '${operation.path}' is not a valid pattern`);
    if (!ACTION_PATTERN.test(operation.action)) throw new ValidationError(`Action '${operation.action}' must look like 'orders:read'`);
    const key = `${method} ${operation.path}`;
    if (seen.has(key)) throw new ValidationError(`Operation '${key}' is declared twice`);
    seen.add(key);
  }
}

function operationRows(organizationId: string, apiId: string, operations: OperationInput[]) {
  return operations.map((operation) => ({
    organizationId,
    apiId,
    method: operation.method.toUpperCase(),
    pathPattern: operation.path,
    action: operation.action,
    description: operation.description ?? null,
  }));
}

async function requireEnvironment(db: TenantDb, scope: EnvironmentScope) {
  const environment = await db.cpEnvironment.findFirst({
    where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
  });
  if (!environment) throw new NotFoundError(`Project '${scope.projectId}' has no ${scope.environmentKind} environment`);
  return environment;
}

async function createApiGrant(
  db: TenantDb,
  application: { id: string; organizationId: string; projectId: string; environmentId: string },
  apiId: string,
  action: string,
  actor: string,
) {
  const existing = await db.cpApplicationGrant.findFirst({
    where: { applicationId: application.id, targetKind: "api", targetId: apiId, action, status: "active" },
  });
  if (existing) return existing;
  const grant = await db.cpApplicationGrant.create({
    data: {
      id: newResourceId("grt"),
      organizationId: application.organizationId,
      projectId: application.projectId,
      environmentId: application.environmentId,
      applicationId: application.id,
      targetKind: "api",
      targetId: apiId,
      action,
      createdBy: actor,
    },
  });
  await db.cpApplication.update({ where: { id: application.id }, data: { authorizationVersion: { increment: 1 } } });
  return grant;
}
