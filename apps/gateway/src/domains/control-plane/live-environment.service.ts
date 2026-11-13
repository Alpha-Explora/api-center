// Live environments: provisioning, readiness and activation.
//
// A live environment is created in 'provisioning'. Applications, grants, configuration and a plan
// can be prepared, but it serves no requests and issues no credentials. Activation re-checks
// readiness, consumes one approved 'environment.activate_live' request for this project and
// activates the environment in the same transaction. Nothing is copied from test: credentials,
// secrets and readiness evidence are always environment-specific.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { ApprovalRequestService } from "@approvals/approval-request.service";
import { AppError, ConflictError, NotFoundError } from "@shared/errors";
import { newResourceId } from "./application-credential";
import { planAllowsLive } from "./quota-budgets";
import { withTenant, type TenantDb } from "./tenant-transaction";

export interface ReadinessCheck {
  key: "plan" | "capability" | "application" | "grant";
  passed: boolean;
  detail: string;
}

@Injectable()
export class LiveEnvironmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalRequestService,
    private readonly audit: AuditEventsService,
  ) {}

  async provision(organizationId: string, projectId: string, actor: string) {
    const environment = await withTenant(this.prisma, { organizationId }, async (db) => {
      const project = await db.cpProject.findFirst({ where: { id: projectId, organizationId } });
      if (!project) throw new NotFoundError(`Project '${projectId}' was not found`);
      try {
        return await db.cpEnvironment.create({
          data: { id: newResourceId("env"), organizationId, projectId, kind: "live", status: "provisioning" },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ConflictError("This project already has a live environment");
        }
        throw error;
      }
    });
    await this.recordAudit("control_plane.live.provisioned", actor, environment.id, { projectId });
    return environment;
  }

  async readiness(organizationId: string, projectId: string) {
    return withTenant(this.prisma, { organizationId }, async (db) => {
      const environment = await requireLive(db, organizationId, projectId);
      const checks = await readinessChecks(db, organizationId, environment.id);
      return {
        environmentId: environment.id,
        status: environment.status,
        checks,
        ready: checks.every((check) => check.passed),
        approval: { actionType: "environment.activate_live", targetEnvironment: "live", targetId: projectId },
      };
    });
  }

  async activate(organizationId: string, projectId: string, approvalRequestId: string, actor: string) {
    const environment = await withTenant(this.prisma, { organizationId }, async (db) => {
      const live = await requireLive(db, organizationId, projectId);
      if (live.status !== "provisioning") throw new ConflictError(`The live environment is already ${live.status}`);
      const failing = (await readinessChecks(db, organizationId, live.id)).filter((check) => !check.passed);
      if (failing.length) {
        throw new AppError(`Live readiness checks fail: ${failing.map((check) => check.key).join(", ")}`, 409, "LIVE_NOT_READY");
      }
      await this.approvals.assertApprovedForAction(
        { approvalRequestId, actionType: "environment.activate_live", targetEnvironment: "live", targetId: projectId, requireTarget: true },
        db,
      );
      return db.cpEnvironment.update({
        where: { id: live.id },
        data: { status: "active", activatedAt: new Date(), activatedBy: actor, activationApprovalId: approvalRequestId },
      });
    });
    await this.recordAudit("control_plane.live.activated", actor, environment.id, { projectId, approvalRequestId });
    return environment;
  }

  /** Suspending blocks requests and issuance immediately; resuming restores an activated environment. */
  async setStatus(organizationId: string, projectId: string, kind: "test" | "live", status: "active" | "suspended", actor: string) {
    const environment = await withTenant(this.prisma, { organizationId }, async (db) => {
      const found = await db.cpEnvironment.findFirst({ where: { organizationId, projectId, kind } });
      if (!found) throw new NotFoundError(`Project '${projectId}' has no ${kind} environment`);
      if (found.status === "provisioning") {
        throw new AppError("Activate the live environment before changing its status", 409, "LIVE_NOT_ACTIVATED");
      }
      return db.cpEnvironment.update({ where: { id: found.id }, data: { status } });
    });
    await this.recordAudit(`control_plane.environment.${status}`, actor, environment.id, { projectId, kind });
    return environment;
  }

  private async recordAudit(type: string, actor: string, resourceId: string, payload: Record<string, unknown>) {
    await this.audit.record({
      type,
      actionFamily: "promotion",
      actor,
      resourceType: "cp_environment",
      resourceId,
      environment: "live",
      severity: "info",
      message: type.replaceAll(".", " "),
      payload,
    });
  }
}

async function requireLive(db: TenantDb, organizationId: string, projectId: string) {
  const live = await db.cpEnvironment.findFirst({ where: { organizationId, projectId, kind: "live" } });
  if (!live) throw new NotFoundError(`Project '${projectId}' has no live environment; provision one first`);
  return live;
}

async function readinessChecks(db: TenantDb, organizationId: string, environmentId: string): Promise<ReadinessCheck[]> {
  const entitlement = await db.cpEntitlement.findFirst({ where: { organizationId, environmentId, status: "active" } });
  const capabilities = await db.cpCapabilityInstallation.count({ where: { organizationId, environmentId, status: "enabled" } });
  const applications = await db.cpApplication.count({ where: { organizationId, environmentId, status: "active" } });
  const grants = await db.cpApplicationGrant.count({ where: { organizationId, environmentId, status: "active" } });
  return [
    {
      key: "plan",
      passed: Boolean(entitlement && planAllowsLive(entitlement.planKey)),
      detail: entitlement ? `Plan '${entitlement.planKey}'` : "Assign a live-capable plan to the live environment",
    },
    { key: "capability", passed: capabilities > 0, detail: `${capabilities} capability(ies) enabled in live` },
    { key: "application", passed: applications > 0, detail: `${applications} live application(s); live identities are separate from test` },
    { key: "grant", passed: grants > 0, detail: `${grants} explicit live grant(s)` },
  ];
}
