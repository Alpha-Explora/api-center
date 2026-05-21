import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { ConfigService } from "../config/config.service";
import {
  EventSchemaRegistryService,
  EventSchemaValidationResult,
} from "../data-pipeline/event-schema-registry.service";
import { PipelineHealthEnvironment } from "../data-pipeline/pipeline-health.dto";
import { KafkaService } from "../kafka/kafka.service";
import { LoggerService } from "../shared/logger.service";
import { MetricsService } from "../metrics/metrics.service";
import { ForbiddenError, ValidationError } from "../shared/errors";
import { KafkaPublishMessageDto } from "./dto/kafka-publish-message.dto";

const RESERVED_TOPIC_PREFIXES = ["api-center.", "__"];
const TOPIC_PREFIX_TEMPLATE = "tribe.<tribe-id>.";
const GOVERNED_SCHEMA_VERSION = "1.0.0";
const DEFAULT_EVENT_SCHEMA_VERSION = "1.0.0";

const GovernedKafkaPayloadSchema = z.object({
  eventType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  sourceServiceId: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

@Injectable()
export class KafkaGovernanceService {
  constructor(
    private readonly kafka: KafkaService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
    private readonly eventSchemaRegistry: EventSchemaRegistryService,
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
  ): Promise<{
    topic: string;
    eventType: string;
    accepted: true;
    schemaValidationStatus: EventSchemaValidationResult["schemaValidationStatus"];
    schemaRegistryVersion: string;
    schemaValidationError?: string;
  }> {
    const normalizedTribeId = this.normalizeTribeId(tribeId);

    this.assertTopicIsTenantScoped(dto.topic, normalizedTribeId);

    const parseResult = GovernedKafkaPayloadSchema.safeParse({
      eventType: dto.eventType,
      payload: dto.payload,
      sourceServiceId: dto.sourceServiceId,
      metadata: dto.metadata,
    });

    if (!parseResult.success) {
      this.metrics.recordKafkaGovernanceOperation("publish", "failure");
      throw new ValidationError(
        `Kafka governance payload validation failed: ${parseResult.error.message}`,
      );
    }

    const eventSchemaVersion =
      dto.schemaVersion?.trim() || DEFAULT_EVENT_SCHEMA_VERSION;
    const schemaValidation = await this.validateEventSchema({
      environment: this.resolvePublishEnvironment(dto.topic),
      tribeId: normalizedTribeId,
      eventType: dto.eventType,
      schemaVersion: eventSchemaVersion,
      payload: parseResult.data.payload,
    });

    if (!schemaValidation.accepted) {
      this.metrics.recordKafkaGovernanceOperation("publish", "failure");
      throw new ValidationError(
        `Kafka schema governance rejected event: ${
          schemaValidation.schemaValidationError ?? "schema not approved"
        }`,
      );
    }

    if (schemaValidation.schemaValidationStatus === "test_discovery") {
      this.logger.warn(
        "Kafka test discovery schema accepted",
        "KafkaGovernanceService",
      );
    }

    await this.kafka.publish(
      dto.topic,
      {
        ...parseResult.data,
        governance: {
          schemaVersion: GOVERNED_SCHEMA_VERSION,
          eventSchemaVersion,
          schemaValidationStatus: schemaValidation.schemaValidationStatus,
          schemaRegistryVersion: schemaValidation.schemaRegistryVersion,
          ...(schemaValidation.schemaValidationError && {
            schemaValidationError: schemaValidation.schemaValidationError,
          }),
          sourceTribeId: tribeId,
          ...(parseResult.data.sourceServiceId && {
            sourceServiceId: parseResult.data.sourceServiceId,
          }),
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
      schemaValidationStatus: schemaValidation.schemaValidationStatus,
      schemaRegistryVersion: schemaValidation.schemaRegistryVersion,
      ...(schemaValidation.schemaValidationError && {
        schemaValidationError: schemaValidation.schemaValidationError,
      }),
    };
  }

  private async validateEventSchema(input: {
    environment: PipelineHealthEnvironment;
    tribeId: string;
    eventType: string;
    schemaVersion: string;
    payload: Record<string, unknown>;
  }): Promise<EventSchemaValidationResult> {
    return this.eventSchemaRegistry.validateEvent({
      ...input,
      allowTestDiscovery: input.environment === "test",
    });
  }

  private assertTopicIsTenantScoped(
    topic: string,
    normalizedTribeId: string,
  ): void {
    const policyTopic = this.stripConfiguredTopicPrefix(topic);

    for (const blockedPrefix of RESERVED_TOPIC_PREFIXES) {
      if (
        topic.startsWith(blockedPrefix) ||
        policyTopic.startsWith(blockedPrefix)
      ) {
        throw new ForbiddenError(
          `Kafka topic '${topic}' is blocked by governance policy`,
        );
      }
    }

    const allowedPrefixes = [
      this.toTenantTopicPrefix(normalizedTribeId),
      `tribe-${normalizedTribeId}.`,
    ];

    if (!allowedPrefixes.some((prefix) => policyTopic.startsWith(prefix))) {
      throw new ForbiddenError(
        `Kafka topic '${topic}' is outside tenant boundary for tribe '${normalizedTribeId}'`,
      );
    }
  }

  private stripConfiguredTopicPrefix(topic: string): string {
    const cleanTopic = topic.trim();
    const cleanPrefix = (this.config?.kafka?.topicPrefix ?? "")
      .trim()
      .replace(/\.+$/, "");

    if (!cleanPrefix) return cleanTopic;
    if (!cleanTopic.startsWith(`${cleanPrefix}.`)) return cleanTopic;

    return cleanTopic.slice(cleanPrefix.length + 1);
  }

  private resolvePublishEnvironment(topic: string): PipelineHealthEnvironment {
    const cleanTopic = topic.trim();
    if (cleanTopic.startsWith("test.")) return "test";
    if (cleanTopic.startsWith("prod.")) return "prod";

    const cleanPrefix = (this.config?.kafka?.topicPrefix ?? "")
      .trim()
      .replace(/\.+$/, "");
    if (cleanPrefix === "test" || cleanPrefix === "prod") {
      return cleanPrefix;
    }

    return this.config?.nodeEnv === "production" ? "prod" : "test";
  }

  private normalizeTribeId(tribeId: string): string {
    return String(tribeId)
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]/g, "-");
  }

  private toTenantTopicPrefix(normalizedTribeId: string): string {
    return `tribe.${normalizedTribeId}.`;
  }
}
