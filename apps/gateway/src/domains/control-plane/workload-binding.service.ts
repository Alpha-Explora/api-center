// Binds exact workload identities to applications. A subject is a Google service account's
// unique numeric ID (the `sub` of its ID tokens), never an email pattern or a domain.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { ConflictError, NotFoundError, ValidationError } from "@shared/errors";
import { withTenant } from "./tenant-transaction";
import { assertControlPlaneAuthority } from "./migration/authority";
import { GOOGLE_ISSUER, workloadAudiences } from "./workload-identity";
import type { EnvironmentScope } from "./control-plane-admin.service";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function bindingId(): string {
  let out = "";
  while (out.length < 24) {
    for (const byte of randomBytes(48)) {
      if (byte < 252) out += ALPHABET[byte % 36];
      if (out.length === 24) break;
    }
  }
  return `wlb_${out}`;
}

@Injectable()
export class WorkloadBindingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventsService,
  ) {}

  async bind(scope: EnvironmentScope, applicationId: string, input: { subject: string; audience: string; description?: string }, actor: string) {
    if (!/^\d{6,32}$/.test(input.subject)) {
      throw new ValidationError("subject must be the service account's unique numeric ID (the `sub` of its ID tokens)");
    }
    if (!workloadAudiences().includes(input.audience)) {
      throw new ValidationError("audience must be one of the gateway's workload audiences (CONTROL_PLANE_WORKLOAD_AUDIENCES)");
    }
    const binding = await withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const environment = await db.cpEnvironment.findFirst({
        where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
      });
      if (!environment) throw new NotFoundError(`Project '${scope.projectId}' has no ${scope.environmentKind} environment`);
      await assertControlPlaneAuthority(db, scope.projectId, scope.environmentKind);
      const application = await db.cpApplication.findFirst({ where: { id: applicationId, organizationId: scope.organizationId, environmentId: environment.id } });
      if (!application) throw new NotFoundError(`Application '${applicationId}' was not found in this environment`);
      try {
        return await db.cpWorkloadBinding.create({
          data: {
            id: bindingId(),
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            environmentId: environment.id,
            applicationId,
            issuer: GOOGLE_ISSUER,
            subject: input.subject,
            audience: input.audience,
            description: input.description ?? null,
            createdBy: actor,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ConflictError("This workload identity is already bound to an application");
        }
        throw error;
      }
    });
    await this.recordAudit("control_plane.workload.bound", actor, binding.id, scope.environmentKind, { applicationId, subject: input.subject });
    return binding;
  }

  async list(scope: EnvironmentScope, applicationId: string) {
    return withTenant(this.prisma, { organizationId: scope.organizationId }, (db) =>
      db.cpWorkloadBinding.findMany({ where: { organizationId: scope.organizationId, projectId: scope.projectId, applicationId }, orderBy: { createdAt: "asc" } }),
    );
  }

  async revoke(scope: EnvironmentScope, applicationId: string, id: string, actor: string) {
    const binding = await withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const found = await db.cpWorkloadBinding.findFirst({ where: { id, organizationId: scope.organizationId, applicationId } });
      if (!found) throw new NotFoundError(`Workload binding '${id}' was not found`);
      if (found.status === "revoked") return found;
      return db.cpWorkloadBinding.update({ where: { id }, data: { status: "revoked", revokedAt: new Date(), revokedBy: actor } });
    });
    await this.recordAudit("control_plane.workload.revoked", actor, id, scope.environmentKind, { applicationId });
    return binding;
  }

  private async recordAudit(type: string, actor: string, resourceId: string, environment: string, payload: Record<string, unknown>) {
    await this.audit.record({ type, actionFamily: "secret", actor, resourceType: "cp_workload_binding", resourceId, environment, severity: "info", message: type.replaceAll(".", " "), payload });
  }
}
