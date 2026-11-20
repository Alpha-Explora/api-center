// Environment-wide reads across every application, so the console can show a getting-started
// checklist and expiring keys without one request per application. Read-only; credentials are
// listed without verifiers, and only while active (revoked keys are on each application's page).

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { NotFoundError } from "@shared/errors";
import { withTenant, type TenantDb } from "./tenant-transaction";
import type { EnvironmentScope } from "./control-plane-admin.service";

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class EnvironmentInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Active credentials of every application in the environment, soonest expiry first. With
   * `expiringWithinDays`, only those that expire within that many days or have already expired.
   */
  async activeCredentials(scope: EnvironmentScope, options: { expiringWithinDays?: number; now?: Date } = {}) {
    const now = options.now ?? new Date();
    const rows = await withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const environment = await this.environment(db, scope);
      return db.cpCredential.findMany({
        where: {
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          environmentId: environment.id,
          status: "active",
          ...(options.expiringWithinDays === undefined ? {} : { expiresAt: { lt: new Date(now.getTime() + options.expiringWithinDays * DAY_MS) } }),
        },
        orderBy: { expiresAt: "asc" },
        take: 500,
      });
    });
    return rows
      .map(({ id, applicationId, lookupPrefix, status, expiresAt, createdAt, lastUsedAt }) => ({
        id,
        applicationId,
        lookupPrefix,
        status,
        expiresAt,
        createdAt,
        lastUsedAt,
      }))
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  }

  /** Active grants of every application in the environment. */
  async activeGrants(scope: EnvironmentScope) {
    const rows = await withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const environment = await this.environment(db, scope);
      return db.cpApplicationGrant.findMany({
        where: { organizationId: scope.organizationId, projectId: scope.projectId, environmentId: environment.id, status: "active" },
        orderBy: { createdAt: "asc" },
        take: 1000,
      });
    });
    return rows.map(({ id, applicationId, targetKind, targetId, action, createdAt }) => ({
      id,
      applicationId,
      targetKind,
      ...(targetKind === "api" ? { apiId: targetId } : { capability: targetId }),
      action,
      createdAt,
    }));
  }

  private async environment(db: TenantDb, scope: EnvironmentScope) {
    const environment = await db.cpEnvironment.findFirst({
      where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
    });
    if (!environment) throw new NotFoundError(`Project '${scope.projectId}' has no ${scope.environmentKind} environment`);
    return environment;
  }
}
