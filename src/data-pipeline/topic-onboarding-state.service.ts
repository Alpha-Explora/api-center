import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ValidationError } from "../shared/errors";
import { TopicOnboardingStateRecord } from "./topic-onboarding-state.dto";

type TopicOnboardingStateRow = {
  record: TopicOnboardingStateRecord | string;
};

@Injectable()
export class TopicOnboardingStateService {
  private readonly records = new Map<string, TopicOnboardingStateRecord>();
  private readonly databaseEnabled = process.env.DATABASE_ENABLED === "true";

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async get(
    physicalTopic: string,
  ): Promise<TopicOnboardingStateRecord | undefined> {
    const database = this.databaseClient();
    if (database) {
      const rows = await database.$queryRawUnsafe<TopicOnboardingStateRow[]>(
        `
          select record
          from api_center_ops.topic_onboarding_states
          where physical_topic = $1
          limit 1
        `,
        physicalTopic,
      );
      return rows[0] ? parseRecord(rows[0].record) : undefined;
    }

    return this.records.get(physicalTopic);
  }

  async upsert(
    physicalTopic: string,
    record: TopicOnboardingStateRecord,
    actorId?: string,
  ): Promise<TopicOnboardingStateRecord> {
    this.validateRecord(physicalTopic, record);
    const database = this.databaseClient();

    if (database) {
      const rows = await database.$queryRawUnsafe<TopicOnboardingStateRow[]>(
        `
          insert into api_center_ops.topic_onboarding_states
            (physical_topic, environment, owner_tribe_id, record, updated_by)
          values ($1, $2, $3, $4::jsonb, $5)
          on conflict (physical_topic) do update set
            environment = excluded.environment,
            owner_tribe_id = excluded.owner_tribe_id,
            record = excluded.record,
            updated_by = excluded.updated_by,
            updated_at = now()
          returning record
        `,
        physicalTopic,
        record.environment,
        record.owner_tribe_id,
        JSON.stringify(record),
        actorId ?? null,
      );
      return parseRecord(rows[0].record);
    }

    this.records.set(physicalTopic, record);
    return record;
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

function parseRecord(value: TopicOnboardingStateRecord | string) {
  return typeof value === "string"
    ? (JSON.parse(value) as TopicOnboardingStateRecord)
    : value;
}
