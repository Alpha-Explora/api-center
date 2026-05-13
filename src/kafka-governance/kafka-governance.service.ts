import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { KafkaService } from "../kafka/kafka.service";
import { LoggerService } from "../shared/logger.service";
import { MetricsService } from "../metrics/metrics.service";
import { ForbiddenError, ValidationError } from "../shared/errors";
import { KafkaPublishMessageDto } from "./dto/kafka-publish-message.dto";

const RESERVED_TOPIC_PREFIXES = ["api-center.", "__"];
const TOPIC_PREFIX_TEMPLATE = "tribe.<tribe-id>.";
const GOVERNED_SCHEMA_VERSION = "1.0.0";

const GovernedKafkaPayloadSchema = z.object({
  eventType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.string()).optional(),
});

@Injectable()
export class KafkaGovernanceService {
  constructor(
    private readonly kafka: KafkaService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {}

  getGovernanceCatalog(tribeId: string) {
    const normalizedTribeId = this.normalizeTribeId(tribeId);
    const tenantTopicPrefix = this.toTenantTopicPrefix(normalizedTribeId);

    this.metrics.recordKafkaGovernanceOperation("catalog", "success");

    return {
      tenantTopicPrefix,
      recommendedTopics: [
        `${tenantTopicPrefix}events`,
        `${tenantTopicPrefix}commands`,
        `${tenantTopicPrefix}audit`,
      ],
      blockedTopicPrefixes: [...RESERVED_TOPIC_PREFIXES],
      requiredScopes: {
        read: ["external:kafka:read"],
        publish: ["external:kafka:write"],
      },
      schemaContract: {
        version: GOVERNED_SCHEMA_VERSION,
        requiredFields: ["eventType", "payload"],
      },
    };
  }

  getSchemaCatalog() {
    this.metrics.recordKafkaGovernanceOperation("schemas", "success");

    return {
      version: GOVERNED_SCHEMA_VERSION,
      schemas: [
        {
          eventType: "string",
          payload: "object",
          metadata: "record<string,string> (optional)",
        },
      ],
      topicPattern: TOPIC_PREFIX_TEMPLATE,
    };
  }

  async publishMessage(
    tribeId: string,
    dto: KafkaPublishMessageDto,
    correlationId?: string,
  ): Promise<{ topic: string; eventType: string; accepted: true }> {
    const normalizedTribeId = this.normalizeTribeId(tribeId);

    this.assertTopicIsTenantScoped(dto.topic, normalizedTribeId);

    const parseResult = GovernedKafkaPayloadSchema.safeParse({
      eventType: dto.eventType,
      payload: dto.payload,
      metadata: dto.metadata,
    });

    if (!parseResult.success) {
      this.metrics.recordKafkaGovernanceOperation("publish", "failure");
      throw new ValidationError(
        `Kafka governance payload validation failed: ${parseResult.error.message}`,
      );
    }

    await this.kafka.publish(
      dto.topic,
      {
        ...parseResult.data,
        governance: {
          schemaVersion: GOVERNED_SCHEMA_VERSION,
          sourceTribeId: tribeId,
          correlationId,
        },
      },
      dto.key ?? normalizedTribeId,
    );

    this.metrics.recordKafkaGovernanceOperation("publish", "success");
    this.logger.info("Kafka governed publish accepted", {
      tribeId,
      topic: dto.topic,
      eventType: dto.eventType,
      correlationId,
    });

    return {
      topic: dto.topic,
      eventType: dto.eventType,
      accepted: true,
    };
  }

  private assertTopicIsTenantScoped(
    topic: string,
    normalizedTribeId: string,
  ): void {
    for (const blockedPrefix of RESERVED_TOPIC_PREFIXES) {
      if (topic.startsWith(blockedPrefix)) {
        throw new ForbiddenError(
          `Kafka topic '${topic}' is blocked by governance policy`,
        );
      }
    }

    const allowedPrefixes = [
      this.toTenantTopicPrefix(normalizedTribeId),
      `tribe-${normalizedTribeId}.`,
    ];

    if (!allowedPrefixes.some((prefix) => topic.startsWith(prefix))) {
      throw new ForbiddenError(
        `Kafka topic '${topic}' is outside tenant boundary for tribe '${normalizedTribeId}'`,
      );
    }
  }

  private normalizeTribeId(tribeId: string): string {
    return String(tribeId)
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]/g, "-");
  }

  private toTenantTopicPrefix(normalizedTribeId: string): string {
    return `tribe.${normalizedTribeId}.`;
  }
}
