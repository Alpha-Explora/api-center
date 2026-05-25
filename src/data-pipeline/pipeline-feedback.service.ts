import { Inject, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { ValidationError } from "../shared/errors";
import {
  PipelineFeedbackAction,
  PipelineFeedbackActionDto,
  PipelineFeedbackTargetType,
} from "./pipeline-feedback.dto";
import { PipelineHealthEnvironment } from "./pipeline-health.dto";

export type PipelineFeedbackStatus =
  | "pending"
  | "reviewed"
  | "blocking"
  | "closed";

export type PipelineFeedbackRecord = {
  id: string;
  action: PipelineFeedbackAction;
  environment: PipelineHealthEnvironment;
  targetType: PipelineFeedbackTargetType;
  targetId: string;
  ownerTribeId?: string;
  evidenceLink?: string;
  reason: string;
  actorId: string;
  actorRole: string;
  correlationId?: string;
  createdAt: string;
  status: PipelineFeedbackStatus;
};

export type PipelineFeedbackActor = {
  actorId: string;
  actorRole: string;
  correlationId?: string;
};

export type PipelineFeedbackListFilter = {
  environment?: PipelineHealthEnvironment;
  targetId?: string;
  targetType?: PipelineFeedbackTargetType;
};

export type PipelineFeedbackServiceOptions = {
  now?: () => Date;
  idFactory?: () => string;
  initialRecords?: PipelineFeedbackRecord[];
  databaseEnabled?: boolean;
};

export const PIPELINE_FEEDBACK_SERVICE_OPTIONS =
  "PIPELINE_FEEDBACK_SERVICE_OPTIONS";

type PipelineFeedbackRow = {
  id: string;
  action: PipelineFeedbackAction;
  environment: PipelineHealthEnvironment;
  target_type: PipelineFeedbackTargetType;
  target_id: string;
  owner_tribe_id: string | null;
  evidence_link: string | null;
  reason: string;
  actor_id: string;
  actor_role: string;
  correlation_id: string | null;
  status: PipelineFeedbackStatus;
  created_at: Date | string;
};

@Injectable()
export class PipelineFeedbackService {
  private readonly records: PipelineFeedbackRecord[];
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly databaseEnabled: boolean;

  constructor(
    @Optional()
    @Inject(PIPELINE_FEEDBACK_SERVICE_OPTIONS)
    options: PipelineFeedbackServiceOptions = {},
    @Optional()
    private readonly prisma?: PrismaService,
  ) {
    this.records = [...(options.initialRecords ?? [])];
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => `pfb_${randomUUID()}`);
    this.databaseEnabled =
      options.databaseEnabled ?? process.env.DATABASE_ENABLED === "true";
  }

  async createFeedbackAction(
    input: PipelineFeedbackActionDto,
    actor: PipelineFeedbackActor,
  ): Promise<PipelineFeedbackRecord> {
    this.validateActionTarget(input);
    const reason = this.normalizeReason(
      input.reason,
      input.action,
      input.environment,
    );
    const status = this.resolveStatus(input.action);

    const database = this.databaseClient();
    if (database) {
      const rows = await database.$queryRawUnsafe<PipelineFeedbackRow[]>(
        `
          insert into api_center_ops.pipeline_feedback_actions
            (
              action,
              environment,
              target_type,
              target_id,
              owner_tribe_id,
              evidence_link,
              reason,
              actor_id,
              actor_role,
              correlation_id,
              status
            )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          returning *
        `,
        input.action,
        input.environment,
        input.targetType,
        input.targetId,
        this.optionalString(input.ownerTribeId) ?? null,
        this.optionalString(input.evidenceLink) ?? null,
        reason,
        actor.actorId,
        actor.actorRole,
        this.optionalString(actor.correlationId) ?? null,
        status,
      );

      return mapFeedbackRow(rows[0]);
    }

    const record: PipelineFeedbackRecord = {
      id: this.idFactory(),
      action: input.action,
      environment: input.environment,
      targetType: input.targetType,
      targetId: input.targetId,
      ownerTribeId: this.optionalString(input.ownerTribeId),
      evidenceLink: this.optionalString(input.evidenceLink),
      reason,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      correlationId: this.optionalString(actor.correlationId),
      createdAt: this.now().toISOString(),
      status,
    };

    this.records.push(record);
    return record;
  }

  async listFeedbackActions(
    filter: PipelineFeedbackListFilter = {},
  ): Promise<PipelineFeedbackRecord[]> {
    const database = this.databaseClient();
    if (database) {
      const clauses: string[] = [];
      const values: string[] = [];

      if (filter.environment) {
        values.push(filter.environment);
        clauses.push(`environment = $${values.length}`);
      }
      if (filter.targetId) {
        values.push(filter.targetId);
        clauses.push(`target_id = $${values.length}`);
      }
      if (filter.targetType) {
        values.push(filter.targetType);
        clauses.push(`target_type = $${values.length}`);
      }

      const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
      const rows = await database.$queryRawUnsafe<PipelineFeedbackRow[]>(
        `
          select *
          from api_center_ops.pipeline_feedback_actions
          ${where}
          order by created_at desc
        `,
        ...values,
      );
      return rows.map(mapFeedbackRow);
    }

    return this.records.filter((record) => {
      if (filter.environment && record.environment !== filter.environment) {
        return false;
      }
      if (filter.targetType && record.targetType !== filter.targetType) {
        return false;
      }
      if (filter.targetId && record.targetId !== filter.targetId) {
        return false;
      }
      return true;
    });
  }

  private normalizeReason(
    value: string | undefined,
    action: PipelineFeedbackAction,
    environment: PipelineHealthEnvironment,
  ): string {
    const reason = value?.trim() ?? "";
    if (reason) return reason;
    if (environment === "prod" && action === "promotion.blocked") {
      throw new ValidationError(
        "reason is required for prod promotion.blocked",
      );
    }
    throw new ValidationError("reason is required");
  }

  private resolveStatus(
    action: PipelineFeedbackAction,
  ): PipelineFeedbackStatus {
    switch (action) {
      case "validation.rerun.requested":
      case "schema.fix.requested":
        return "pending";
      case "evidence.reviewed":
      case "onboarding.state.opened":
        return "reviewed";
      case "decision.false_positive.marked":
        return "closed";
      case "promotion.blocked":
        return "blocking";
    }
  }

  private validateActionTarget(input: PipelineFeedbackActionDto): void {
    if (
      input.action === "decision.false_positive.marked" &&
      input.targetType !== "signal"
    ) {
      throw new ValidationError(
        "decision.false_positive.marked requires targetType=signal",
      );
    }
  }

  private optionalString(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private databaseClient(): PrismaService | undefined {
    if (!this.databaseEnabled) {
      return undefined;
    }
    if (!this.prisma) {
      throw new Error(
        "DATABASE_ENABLED=true requires PrismaService for pipeline feedback persistence",
      );
    }
    return this.prisma;
  }
}

function mapFeedbackRow(row: PipelineFeedbackRow): PipelineFeedbackRecord {
  return {
    id: row.id,
    action: row.action,
    environment: row.environment,
    targetType: row.target_type,
    targetId: row.target_id,
    ownerTribeId: row.owner_tribe_id ?? undefined,
    evidenceLink: row.evidence_link ?? undefined,
    reason: row.reason,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    correlationId: row.correlation_id ?? undefined,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    status: row.status,
  };
}
