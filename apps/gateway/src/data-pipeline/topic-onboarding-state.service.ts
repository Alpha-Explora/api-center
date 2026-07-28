import { Injectable, Optional } from "@nestjs/common";
import { AuditEventsService } from "../analytics/audit-events.service";
import { PrismaService } from "../database/prisma.service";
import { ValidationError } from "../shared/errors";
import { requireGovernanceDependency } from "../shared/governance-dependencies";
import { TopicOnboardingStateRecord } from "./topic-onboarding-state.dto";

@Injectable()
export class TopicOnboardingStateService {
  private readonly records = new Map<string, TopicOnboardingStateRecord>();
  private readonly databaseEnabled = process.env.DATABASE_ENABLED === "true";

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly auditEvents?: AuditEventsService,
  ) {}

  async get(
    physicalTopic: string,
  ): Promise<TopicOnboardingStateRecord | undefined> {
    const database = this.databaseClient();
    if (database) {
      const row = await database.eventTopicOnboardingState.findUnique({
        where: { physicalTopic },
      });
      return row ? parseRecord(row.record) : undefined;
    }

    return this.records.get(physicalTopic);
  }

  async upsert(
    physicalTopic: string,
    record: TopicOnboardingStateRecord,
    actorId?: string,
    correlationId?: string,
  ): Promise<TopicOnboardingStateRecord> {
    this.validateRecord(physicalTopic, record);
    const database = this.databaseClient();

    if (database) {
      const row = await database.eventTopicOnboardingState.upsert({
        where: { physicalTopic },
        create: {
          physicalTopic,
          environment: record.environment,
          ownerTribeId: record.owner_tribe_id,
          record: record as any,
          updatedBy: actorId,
        },
        update: {
          environment: record.environment,
          ownerTribeId: record.owner_tribe_id,
          record: record as any,
          updatedBy: actorId,
        },
      });
      const saved = parseRecord(row.record);
      await this.recordRuntimeEvidence(
        physicalTopic,
        saved,
        actorId,
        correlationId,
      );
      return saved;
    }

    this.records.set(physicalTopic, record);
    await this.recordRuntimeEvidence(
      physicalTopic,
      record,
      actorId,
      correlationId,
    );
    return record;
  }

  private async recordRuntimeEvidence(
    physicalTopic: string,
    record: TopicOnboardingStateRecord,
    actorId?: string,
    correlationId?: string,
  ): Promise<void> {
    await this.recordAudit(
      this.isTopicProvisioned(record)
        ? "runtime.topic.provisioned"
        : "runtime.topic.provision_requested",
      "event_topic",
      physicalTopic,
      record,
      actorId,
      correlationId,
    );

    if (this.hasSinkBinding(record)) {
      await this.recordAudit(
        "runtime.sink.binding_created",
        "data_sink",
        record.connector_name ?? physicalTopic,
        record,
        actorId,
        correlationId,
      );
    }
  }

  private async recordAudit(
    type:
      | "runtime.topic.provision_requested"
      | "runtime.topic.provisioned"
      | "runtime.sink.binding_created",
    resourceType: "event_topic" | "data_sink",
    resourceId: string,
    record: TopicOnboardingStateRecord,
    actorId?: string,
    correlationId?: string,
  ): Promise<void> {
    const auditEvents = requireGovernanceDependency(
      this.auditEvents,
      "AuditEventsService",
    );
    await auditEvents.recordRequired({
      type,
      actionFamily: "runtime",
      actor: actorId ?? "platform-admin",
      serviceId: record.service_id,
      resourceType,
      resourceId,
      environment: record.environment,
      correlationId: correlationId ?? physicalCorrelationId(record),
      severity: "info",
      message: `${type} for ${record.physical_topic}`,
      payload: {
        ownerTribeId: record.owner_tribe_id,
        logicalTopic: record.logical_topic,
        physicalTopic: record.physical_topic,
        currentState: record.current_state,
        connectorName: record.connector_name,
        s3Prefix: record.s3_prefix,
      },
    });
  }

  private isTopicProvisioned(record: TopicOnboardingStateRecord): boolean {
    return record.current_state.toLowerCase().includes("provisioned");
  }

  private hasSinkBinding(record: TopicOnboardingStateRecord): boolean {
    return Boolean(record.connector_name?.trim() || record.s3_prefix?.trim());
  }

  private validateRecord(
    physicalTopic: string,
    record: TopicOnboardingStateRecord,
  ) {
    if (!record || typeof record !== "object") {
      throw new ValidationError("record must be an object");
    }
    if (record.physical_topic !== physicalTopic) {
      throw new ValidationError(
        "record.physical_topic must match the route topic",
      );
    }
    if (!record.environment) {
      throw new ValidationError("record.environment is required");
    }
    if (!record.owner_tribe_id) {
      throw new ValidationError("record.owner_tribe_id is required");
    }
  }

  private databaseClient(): PrismaService | undefined {
    if (!this.databaseEnabled) return undefined;
    if (!this.prisma) {
      throw new Error(
        "DATABASE_ENABLED=true requires PrismaService for topic onboarding state persistence",
      );
    }
    return this.prisma;
  }
}

function parseRecord(value: unknown) {
  return typeof value === "string"
    ? (JSON.parse(value) as TopicOnboardingStateRecord)
    : (value as TopicOnboardingStateRecord);
}

function physicalCorrelationId(record: TopicOnboardingStateRecord): string {
  return `${record.environment}:${record.physical_topic}`;
}
