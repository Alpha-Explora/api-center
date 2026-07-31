import {
  Body,
  Controller,
  Get,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { ValidationError } from "@shared/errors";
import { requireGovernanceDependency } from "@shared/governance-dependencies";
import { AuthenticatedRequest } from "../../../types";
import { AuditEventsService } from "@analytics/audit-events.service";
import { TribePlanService } from "./tribe-plan.service";
import {
  AssignTribePlanResult,
  ListTribePlanAssignmentsInput,
  TribePlanAssignment,
  TribePlanAssignmentStatus,
  TribePlanDefinition,
  TribePlanEnvironment,
  TribePlanKey,
} from "./tribe-plan.types";

const PLAN_KEYS: TribePlanKey[] = ["starter", "standard", "pro", "enterprise"];
const ENVIRONMENTS: TribePlanEnvironment[] = ["test", "prod"];
const ASSIGNMENT_STATUSES: TribePlanAssignmentStatus[] = ["active", "disabled"];

interface AssignPlanRequest {
  ownerTribeId?: string;
  planKey?: TribePlanKey;
  environment?: TribePlanEnvironment;
  effectiveAt?: string;
  reason?: string;
}

interface UpdateAssignmentRequest {
  status?: TribePlanAssignmentStatus;
  reason?: string;
}

@Controller("plans")
@UseGuards(ScopedAdminGuard)
export class TribePlanAdminController {
  constructor(
    private readonly plans: TribePlanService,
    @Optional()
    private readonly auditEvents?: AuditEventsService,
  ) {}

  @Get("definitions")
  listDefinitions(@Req() req: AuthenticatedRequest) {
    return this.response(this.plans.listPlanDefinitions(), req);
  }

  @Get("assignments")
  async listAssignments(
    @Query() query: ListTribePlanAssignmentsInput,
    @Req() req: AuthenticatedRequest,
  ) {
    this.validateAssignmentFilters(query);
    return this.response(await this.plans.listPlanAssignments(query), req);
  }

  @Post("assignments")
  async assignPlan(
    @Body() body: AssignPlanRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    this.validateAssignment(body);
    const result = await this.plans.assignPlan({
      ownerTribeId: body.ownerTribeId!,
      planKey: body.planKey!,
      environment: body.environment!,
      effectiveAt: body.effectiveAt ? new Date(body.effectiveAt) : undefined,
      reason: body.reason!,
      assignedBy: req.user?.tribeId ?? req.tribeId,
    });
    const auditEvents = requireGovernanceDependency(
      this.auditEvents,
      "AuditEventsService",
    );
    await auditEvents.recordRequired({
      type: "entitlement.assignment.created",
      actionFamily: "plan",
      actor: req.user?.tribeId ?? req.tribeId ?? "platform",
      resourceType: "entitlement_assignment",
      resourceId: result.assignment.id,
      environment: body.environment!,
      correlationId: req.correlationId ?? result.assignment.id,
      severity: "info",
      message: `Plan ${body.planKey} assigned to ${body.ownerTribeId}`,
      payload: {
        ownerTribeId: body.ownerTribeId,
        planKey: body.planKey,
        environment: body.environment,
        correlationId: req.correlationId,
      },
    });

    return this.response(result, req);
  }

  @Patch("assignments/:assignmentId")
  async updateAssignment(
    @Param("assignmentId") assignmentId: string,
    @Body() body: UpdateAssignmentRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    this.validateAssignmentUpdate(assignmentId, body);
    const assignment = await this.plans.updatePlanAssignment({
      assignmentId,
      status: body.status!,
      reason: body.reason!,
      updatedBy: req.user?.tribeId ?? req.tribeId,
    });
    const auditEvents = requireGovernanceDependency(
      this.auditEvents,
      "AuditEventsService",
    );
    await auditEvents.recordRequired({
      type: "entitlement.assignment.updated",
      actionFamily: "plan",
      actor: req.user?.tribeId ?? req.tribeId ?? "platform",
      resourceType: "entitlement_assignment",
      resourceId: assignment.id ?? assignmentId,
      environment: assignment.environment,
      correlationId: req.correlationId ?? assignment.id ?? assignmentId,
      severity: "info",
      message: `Plan assignment ${assignment.id ?? assignmentId} updated`,
      payload: {
        assignmentId: assignment.id ?? assignmentId,
        ownerTribeId: assignment.ownerTribeId,
        planKey: assignment.planKey,
        environment: assignment.environment,
        status: assignment.status,
        reason: assignment.reason,
        correlationId: req.correlationId,
      },
    });

    return this.response(assignment, req);
  }

  private validateAssignmentUpdate(
    assignmentId: string,
    body: UpdateAssignmentRequest,
  ) {
    if (!assignmentId.trim()) {
      throw new ValidationError("assignmentId is required");
    }
    if (!body.status || !ASSIGNMENT_STATUSES.includes(body.status)) {
      throw new ValidationError("status is invalid");
    }
    if (!body.reason?.trim()) {
      throw new ValidationError("reason is required");
    }
  }

  private validateAssignment(body: AssignPlanRequest) {
    if (!body.ownerTribeId?.trim()) {
      throw new ValidationError("ownerTribeId is required");
    }
    if (!body.planKey || !PLAN_KEYS.includes(body.planKey)) {
      throw new ValidationError("planKey is invalid");
    }
    if (!body.environment || !ENVIRONMENTS.includes(body.environment)) {
      throw new ValidationError("environment is invalid");
    }
    if (!body.reason?.trim()) {
      throw new ValidationError("reason is required");
    }
    if (
      body.effectiveAt &&
      Number.isNaN(new Date(body.effectiveAt).getTime())
    ) {
      throw new ValidationError("effectiveAt must be a valid date");
    }
  }

  private validateAssignmentFilters(query: ListTribePlanAssignmentsInput) {
    if (query.planKey && !PLAN_KEYS.includes(query.planKey)) {
      throw new ValidationError("planKey is invalid");
    }
    if (query.environment && !ENVIRONMENTS.includes(query.environment)) {
      throw new ValidationError("environment is invalid");
    }
    if (query.status && !ASSIGNMENT_STATUSES.includes(query.status)) {
      throw new ValidationError("status is invalid");
    }
  }

  private response<
    T extends
      | TribePlanDefinition[]
      | TribePlanAssignment[]
      | TribePlanAssignment
      | AssignTribePlanResult,
  >(data: T, req: AuthenticatedRequest) {
    return {
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }
}
