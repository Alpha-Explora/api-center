import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApprovalRequestService } from "@approvals/approval-request.service";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { TENANCY_DIRECTORY, type TenancyDirectory } from "@registry/tenancy.types";
import { ValidationError } from "@shared/errors";
import { requireGovernanceDependency } from "@shared/governance-dependencies";
import { AuthenticatedRequest } from "../../../types";
import { TribeQuotaPolicyService } from "./tribe-quota-policy.service";
import {
  CreateTribeQuotaPolicyInput,
  TribeQuotaMode,
  TribeQuotaPolicy,
  TribeQuotaScope,
  TribeQuotaStatus,
  UpdateTribeQuotaPolicyInput,
} from "./tribe-quota-policy.types";
import { AuditEventsService } from "@analytics/audit-events.service";

const SCOPES: TribeQuotaScope[] = ["all", "shared", "tribe", "kafka_publish"];
const MODES: TribeQuotaMode[] = ["observe", "enforce"];
const STATUSES: TribeQuotaStatus[] = ["active", "disabled"];

@Controller("quotas/policies")
@UseGuards(ScopedAdminGuard)
export class TribeQuotaAdminController {
  constructor(
    private readonly policies: TribeQuotaPolicyService,
    private readonly approvals: ApprovalRequestService,
    @Inject(TENANCY_DIRECTORY) private readonly tenancy: TenancyDirectory,
    @Optional()
    private readonly auditEvents?: AuditEventsService,
  ) {}

  @Get()
  async listPolicies(
    @Query("ownerTribeId") ownerTribeId: string | undefined,
    @Query("projectId") projectId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const policies = await this.policies.listPolicies({ ownerTribeId, projectId });
    return this.response(
      policies.map((policy) => this.toPolicyResponse(policy)),
      req,
      { total: policies.length },
    );
  }

  @Post()
  async createPolicy(
    @Body() body: CreateTribeQuotaPolicyInput,
    @Req() req: AuthenticatedRequest,
  ) {
    this.validatePolicyInput(body, true);
    const owner = this.resolveOwner(body);
    const actor = this.resolveActor(req);
    await this.requireQuotaApproval(body.approvalRequestId, {
      mode: body.mode ?? "observe",
      targetId: owner.projectId ?? owner.ownerTribeId,
    });
    const { approvalRequestId: _approvalRequestId, ...policyInput } = body;
    const policy = await this.policies.createPolicy({
      ...policyInput,
      ...owner,
      mode: policyInput.mode ?? "observe",
      createdBy: actor,
      updatedBy: actor,
    });
    await this.recordAudit(
      "quota.policy.created",
      owner.ownerTribeId,
      actor,
      req,
      {
        mode: policy.mode,
        policyId: policy.id,
        projectId: owner.projectId,
      },
    );

    return this.response(this.toPolicyResponse(policy), req);
  }

  @Patch(":policyId")
  async updatePolicy(
    @Param("policyId") policyId: string,
    @Body() body: UpdateTribeQuotaPolicyInput,
    @Req() req: AuthenticatedRequest,
  ) {
    this.validatePolicyInput(body, false);
    await this.requireQuotaApproval(body.approvalRequestId, {
      mode: body.mode,
      targetId: policyId,
    });
    const { approvalRequestId: _approvalRequestId, ...policyInput } = body;
    const policy = await this.policies.updatePolicy(policyId, {
      ...policyInput,
      updatedBy: this.resolveActor(req),
    });
    await this.recordAudit(
      "quota.policy.updated",
      policy.ownerTribeId,
      this.resolveActor(req),
      req,
      { mode: policy.mode, policyId: policy.id },
    );

    return this.response(this.toPolicyResponse(policy), req);
  }

  @Delete(":policyId")
  async deletePolicy(
    @Param("policyId") policyId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const policy = await this.policies.disablePolicy(policyId, {
      updatedBy: this.resolveActor(req),
    });
    await this.recordAudit(
      "quota.policy.disabled",
      policy.ownerTribeId,
      this.resolveActor(req),
      req,
      { mode: policy.mode, policyId: policy.id },
    );

    return this.response(this.toPolicyResponse(policy), req);
  }

  private validatePolicyInput(
    input: Partial<CreateTribeQuotaPolicyInput & UpdateTribeQuotaPolicyInput>,
    requireAll: boolean,
  ): void {
    if (requireAll && !input.ownerTribeId?.trim() && !input.projectId?.trim()) {
      throw new ValidationError("projectId (project budget) or ownerTribeId (tribe ceiling) is required");
    }
    if (!requireAll && (input as { projectId?: unknown }).projectId !== undefined) {
      throw new ValidationError("projectId cannot change; disable the policy and create a new one");
    }
    if (requireAll && !input.reason?.trim()) {
      throw new ValidationError("reason is required");
    }
    if (input.scope !== undefined && !SCOPES.includes(input.scope)) {
      throw new ValidationError("scope is invalid");
    }
    if (input.mode !== undefined && !MODES.includes(input.mode)) {
      throw new ValidationError("mode is invalid");
    }
    if (input.status !== undefined && !STATUSES.includes(input.status)) {
      throw new ValidationError("status is invalid");
    }
    if (requireAll || input.windowSeconds !== undefined) {
      const windowSeconds = input.windowSeconds;
      if (!Number.isInteger(windowSeconds) || (windowSeconds ?? 0) <= 0) {
        throw new ValidationError("windowSeconds must be a positive integer");
      }
    }
    if (requireAll || input.maxRequests !== undefined) {
      const maxRequests = input.maxRequests;
      if (!Number.isInteger(maxRequests) || (maxRequests ?? 0) <= 0) {
        throw new ValidationError("maxRequests must be a positive integer");
      }
    }
    if (
      input.burstRequests !== undefined &&
      input.burstRequests !== null &&
      (!Number.isInteger(input.burstRequests) ||
        (input.maxRequests !== undefined &&
          input.burstRequests < input.maxRequests))
    ) {
      throw new ValidationError(
        "burstRequests must be greater than or equal to maxRequests",
      );
    }
  }

  /**
   * A policy with a project is that project's budget and takes its tribe from the project.
   * A policy without one is a tribe-wide ceiling.
   */
  private resolveOwner(input: CreateTribeQuotaPolicyInput): {
    ownerTribeId: string;
    projectId: string | null;
  } {
    const projectId = input.projectId?.trim();
    if (projectId) {
      const placement = this.tenancy.resolveProject(projectId);
      if (!placement) throw new ValidationError(`Project '${projectId}' is not registered`);
      const ownerTribeId = input.ownerTribeId?.trim();
      if (ownerTribeId && ownerTribeId !== placement.tribe.tribeId) {
        throw new ValidationError(
          `Project '${projectId}' belongs to tribe '${placement.tribe.tribeId}', not '${ownerTribeId}'`,
        );
      }
      return { ownerTribeId: placement.tribe.tribeId, projectId };
    }

    const ownerTribeId = input.ownerTribeId!.trim();
    if (!this.tenancy.getTribe(ownerTribeId)) {
      throw new ValidationError(`Tribe '${ownerTribeId}' is not registered`);
    }
    return { ownerTribeId, projectId: null };
  }

  private toPolicyResponse(policy: TribeQuotaPolicy) {
    return {
      id: policy.id,
      ownerTribeId: policy.ownerTribeId,
      projectId: policy.projectId ?? null,
      level: policy.projectId ? "project" : "tribe",
      scope: policy.scope,
      targetServiceId: policy.targetServiceId ?? null,
      windowSeconds: policy.windowSeconds,
      maxRequests: policy.maxRequests,
      burstRequests: policy.burstRequests ?? null,
      mode: policy.mode,
      status: policy.status,
      reason: policy.reason,
      updatedAt: this.toIso(policy.updatedAt),
    };
  }

  private response<T>(data: T, req: AuthenticatedRequest, meta = {}) {
    return {
      success: true,
      data,
      meta: {
        ...meta,
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }

  private resolveActor(req: AuthenticatedRequest): string | undefined {
    return req.user?.sub ?? req.tribeId;
  }

  private async requireQuotaApproval(
    approvalRequestId: string | undefined,
    input: { mode?: TribeQuotaMode; targetId: string },
  ) {
    if (input.mode !== "enforce") return;
    const approvals = requireGovernanceDependency(
      this.approvals,
      "ApprovalRequestService",
    );
    await approvals.assertApprovedForAction({
      approvalRequestId,
      actionType: "quota.enforce",
      targetEnvironment: "live",
      targetId: input.targetId,
    });
  }

  private toIso(value: Date | string | undefined): string | undefined {
    if (!value) return undefined;
    return value instanceof Date ? value.toISOString() : value;
  }

  private async recordAudit(
    type: string,
    ownerTribeId: string,
    actor: string | undefined,
    req: AuthenticatedRequest,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const auditEvents = requireGovernanceDependency(
      this.auditEvents,
      "AuditEventsService",
    );
    await auditEvents.recordRequired({
      type,
      actionFamily: "quota",
      actor: actor ?? "platform",
      resourceType: "quota_policy",
      resourceId: String(payload.policyId ?? ownerTribeId),
      environment: "live",
      correlationId:
        req.correlationId ?? String(payload.policyId ?? ownerTribeId),
      severity: "info",
      message: `Quota policy updated for ${ownerTribeId}`,
      payload: {
        ownerTribeId,
        correlationId: req.correlationId,
        ...payload,
      },
    });
  }
}
