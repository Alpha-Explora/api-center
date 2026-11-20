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
import { AuditEventsService, type AuditOwner } from "@audit/audit-events.service";
import { ApprovalRequestService } from "@approvals/approval-request.service";
import { AppError, ConflictError, NotFoundError } from "@shared/errors";
import { newResourceId } from "./application-credential";
import { listPlans, planAllowsLive } from "./quota-budgets";
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
    await this.recordAudit({ organizationId, projectId }, "control_plane.live.provisioned", actor, environment.id, { projectId });
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

  /**
   * File the environment.activate_live request that a different person must approve. Only a
   * provisioning environment that passes readiness can ask, and only when no request is open.
   */
  async requestActivation(organizationId: string, projectId: string, requestedBy: string, reason: string) {
    const readiness = await this.readiness(organizationId, projectId);
    if (readiness.status !== "provisioning") throw new ConflictError(`The live environment is already ${readiness.status}`);
    const failing = readiness.checks.filter((check) => !check.passed);
    if (failing.length) {
      throw new AppError(`Live readiness checks fail: ${failing.map((check) => check.key).join(", ")}`, 409, "LIVE_NOT_READY");
    }
    const open = (await this.approvals.listForTarget("environment.activate_live", projectId)).find(
      (entry) => entry.status === "pending" || (entry.status === "approved" && !ApprovalRequestService.isExpired(entry)),
    );
    if (open) {
      throw new AppError(`Activation was already requested (${open.status}); decide or use that request`, 409, "ACTIVATION_ALREADY_REQUESTED");
    }
    const request = await this.approvals.createRequest({
      actionType: "environment.activate_live",
      targetId: projectId,
      targetEnvironment: "live",
      before: { status: readiness.status },
      after: { status: "active", checks: readiness.checks.map((check) => check.detail) },
      riskLevel: "high",
      reason,
      requestedBy,
    });
    await this.recordAudit({ organizationId, projectId }, "control_plane.live.activation_requested", requestedBy, readiness.environmentId, { projectId, approvalRequestId: request.id });
    return request;
  }

  /** Activation requests for this project, newest first. */
  async listActivationRequests(organizationId: string, projectId: string) {
    // Only confirms the live environment exists; the readiness checks are not needed here.
    await withTenant(this.prisma, { organizationId }, (db) => requireLive(db, organizationId, projectId));
    return this.approvals.listForTarget("environment.activate_live", projectId);
  }

  /**
   * Approve or reject one activation request. The decider is a signed-in person; the approval
   * service refuses a requester approving their own request.
   */
  async decideActivation(
    organizationId: string,
    projectId: string,
    approvalRequestId: string,
    decision: { approve: true; by: string } | { approve: false; by: string; reason: string },
  ) {
    await withTenant(this.prisma, { organizationId }, (db) => requireLive(db, organizationId, projectId));
    // Looked up by ID, not among the newest few, so an older open request can still be decided.
    const pending = await this.approvals.findForTarget(approvalRequestId, "environment.activate_live", projectId);
    if (!pending) throw new NotFoundError(`No live activation request '${approvalRequestId}' for project '${projectId}'`);
    const request = decision.approve
      ? await this.approvals.approveRequest(approvalRequestId, decision.by)
      : await this.approvals.rejectRequest(approvalRequestId, decision.by, decision.reason);
    await this.recordAudit(
      { organizationId, projectId },
      decision.approve ? "control_plane.live.activation_approved" : "control_plane.live.activation_rejected",
      decision.by,
      projectId,
      { projectId, approvalRequestId, requestedBy: request.requestedBy },
    );
    return request;
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
    await this.recordAudit({ organizationId, projectId }, "control_plane.live.activated", actor, environment.id, { projectId, approvalRequestId });
    return environment;
  }

  /**
   * Suspending blocks requests and issuance immediately; resuming restores an activated environment.
   * An environment an APICenter operator suspended can only be resumed by an operator.
   */
  async setStatus(
    organizationId: string,
    projectId: string,
    kind: "test" | "live",
    status: "active" | "suspended",
    actor: string,
    options: { platform: boolean } = { platform: false },
  ) {
    const environment = await withTenant(this.prisma, { organizationId }, async (db) => {
      const found = await db.cpEnvironment.findFirst({ where: { organizationId, projectId, kind } });
      if (!found) throw new NotFoundError(`Project '${projectId}' has no ${kind} environment`);
      if (found.status === "provisioning") {
        throw new AppError("Activate the live environment before changing its status", 409, "LIVE_NOT_ACTIVATED");
      }
      if (found.suspendedByPlatform && !options.platform) {
        throw new AppError("An APICenter operator suspended this environment; ask them to resume it", 403, "SUSPENDED_BY_PLATFORM");
      }
      return db.cpEnvironment.update({
        where: { id: found.id },
        data: { status, suspendedByPlatform: status === "suspended" && options.platform },
      });
    });
    await this.recordAudit({ organizationId, projectId }, `control_plane.environment.${status}`, actor, environment.id, { projectId, kind }, kind);
    return environment;
  }

  /** Every event here concerns the live environment except suspend and resume, which name their own. */
  private async recordAudit(
    owner: AuditOwner,
    type: string,
    actor: string,
    resourceId: string,
    payload: Record<string, unknown>,
    environment: "test" | "live" = "live",
  ) {
    await this.audit.record({
      type,
      organizationId: owner.organizationId,
      projectId: owner.projectId,
      actionFamily: "promotion",
      actor,
      resourceType: "cp_environment",
      resourceId,
      environment,
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
      detail: entitlement
        ? planAllowsLive(entitlement.planKey)
          ? `${planName(entitlement.planKey)} plan`
          : `${planName(entitlement.planKey)} plan is test-only; assign a live-capable plan`
        : "Assign a live-capable plan to the live environment",
    },
    {
      key: "capability",
      passed: capabilities > 0,
      detail: capabilities > 0 ? `${count(capabilities, "capability", "capabilities")} enabled in live` : "Enable a capability in live",
    },
    {
      key: "application",
      passed: applications > 0,
      detail: applications > 0 ? `${count(applications, "live application")}, separate from test` : "Create a live application; test applications don't carry over",
    },
    {
      key: "grant",
      passed: grants > 0,
      detail: grants > 0 ? `${count(grants, "action")} granted in live` : "Grant actions to a live application",
    },
  ];
}

/** "1 action", "27 actions". */
function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function planName(planKey: string): string {
  return listPlans().find((plan) => plan.planKey === planKey)?.displayName ?? planKey;
}
