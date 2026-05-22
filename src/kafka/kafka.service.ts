// =============================================================================
// src/kafka/kafka.service.ts — Kafka producer & consumer service (NestJS)
// =============================================================================
// Injectable NestJS service wrapping KafkaJS.
//
// REPLACES: Express kafkaClient singleton
// NestJS ADVANTAGE: The service implements OnModuleInit and OnModuleDestroy
// lifecycle hooks, so Kafka connects on startup and disconnects on shutdown
// automatically — no manual bootstrap/graceful-shutdown code needed.
// =============================================================================

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import { Kafka, logLevel, Producer, Consumer } from "kafkajs";
import { ZodSchema } from "zod";
import { ConfigService } from "../config/config.service";
import { AuditEventsService } from "../analytics/audit-events.service";
import { GatewayTrafficService } from "../analytics/gateway-traffic.service";
import { LoggerService } from "../shared/logger.service";
import { MetricsService } from "../metrics/metrics.service";
import { TOPICS, withTopicPrefix } from "./topics";
import {
  GatewayRequestEventSchema,
  GatewayResponseEventSchema,
  GatewayErrorEventSchema,
  AuditLogEventSchema,
  ExternalRequestEventSchema,
  RegistryServiceRegisteredEventSchema,
  RegistryServiceDeregisteredEventSchema,
  RegistryServiceDeprecatedEventSchema,
  RegistryServiceRetiredEventSchema,
  RegistryServiceVersionChangedEventSchema,
  RegistryServiceHealthChangedEventSchema,
  TribeRequestEventSchema,
  TribeResponseEventSchema,
  TokenIssuedEventSchema,
  TokenRefreshedEventSchema,
  TokenRevokedEventSchema,
  SharedServiceExportEventSchema,
} from "./schemas";

/**
 * Maps each Kafka topic to its Zod validation schema.
 * Topics not listed here are published without validation.
 */
const TOPIC_SCHEMAS: Record<string, ZodSchema> = {
  [TOPICS.GATEWAY_REQUEST]: GatewayRequestEventSchema,
  [TOPICS.GATEWAY_RESPONSE]: GatewayResponseEventSchema,
  [TOPICS.GATEWAY_ERROR]: GatewayErrorEventSchema,
  [TOPICS.AUDIT_LOG]: AuditLogEventSchema,
  [TOPICS.EXTERNAL_REQUEST]: ExternalRequestEventSchema,
  [TOPICS.SERVICE_REGISTERED]: RegistryServiceRegisteredEventSchema,
  [TOPICS.SERVICE_DEREGISTERED]: RegistryServiceDeregisteredEventSchema,
  [TOPICS.SERVICE_DEPRECATED]: RegistryServiceDeprecatedEventSchema,
  [TOPICS.SERVICE_RETIRED]: RegistryServiceRetiredEventSchema,
  [TOPICS.SERVICE_VERSION_CHANGED]: RegistryServiceVersionChangedEventSchema,
  [TOPICS.SERVICE_HEALTH_CHANGED]: RegistryServiceHealthChangedEventSchema,
  [TOPICS.TRIBE_REQUEST]: TribeRequestEventSchema,
  [TOPICS.TRIBE_RESPONSE]: TribeResponseEventSchema,
  [TOPICS.TOKEN_ISSUED]: TokenIssuedEventSchema,
  [TOPICS.TOKEN_REFRESHED]: TokenRefreshedEventSchema,
  [TOPICS.TOKEN_REVOKED]: TokenRevokedEventSchema,
  [TOPICS.SHARED_SMS_EVENTS]: SharedServiceExportEventSchema,
  [TOPICS.SHARED_EMAIL_EVENTS]: SharedServiceExportEventSchema,
  [TOPICS.SHARED_PAYMENT_EVENTS]: SharedServiceExportEventSchema,
  [TOPICS.SHARED_OTP_EVENTS]: SharedServiceExportEventSchema,
  [TOPICS.SHARED_GEO_EVENTS]: SharedServiceExportEventSchema,
  [TOPICS.SHARED_GAUTH_EVENTS]: SharedServiceExportEventSchema,
};

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly consumers: Map<string, Consumer> = new Map();
  private connected = false;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly gatewayTraffic?: GatewayTrafficService,
    @Optional() private readonly auditEvents?: AuditEventsService,
  ) {
    this.kafka = this.createKafkaClient();

    this.producer = this.kafka.producer();
  }

  private createKafkaClient(): Kafka {
    const kafkaConfig: {
      clientId: string;
      brokers: string[];
      logLevel: number;
      ssl?:
        | boolean
        | {
            rejectUnauthorized: boolean;
            ca?: string[];
          };
      sasl?:
        | { mechanism: "plain"; username: string; password: string }
        | { mechanism: "scram-sha-256"; username: string; password: string }
        | { mechanism: "scram-sha-512"; username: string; password: string };
    } = {
      clientId: this.config.kafka.clientId,
      brokers: this.config.kafka.brokers,
      logLevel: logLevel.WARN,
    };

    if (this.config.kafka.sslEnabled) {
      if (this.config.kafka.sslCaPem) {
        kafkaConfig.ssl = {
          rejectUnauthorized: this.config.kafka.sslRejectUnauthorized,
          ca: [this.config.kafka.sslCaPem],
        };
      } else {
        kafkaConfig.ssl = this.config.kafka.sslRejectUnauthorized
          ? true
          : { rejectUnauthorized: false };
      }
    }

    if (
      this.config.kafka.saslMechanism &&
      this.config.kafka.saslUsername &&
      this.config.kafka.saslPassword
    ) {
      const saslUsername = this.config.kafka.saslUsername;
      const saslPassword = this.config.kafka.saslPassword;

      if (this.config.kafka.saslMechanism === "plain") {
        kafkaConfig.sasl = {
          mechanism: "plain",
          username: saslUsername,
          password: saslPassword,
        };
      }

      if (this.config.kafka.saslMechanism === "scram-sha-256") {
        kafkaConfig.sasl = {
          mechanism: "scram-sha-256",
          username: saslUsername,
          password: saslPassword,
        };
      }

      if (this.config.kafka.saslMechanism === "scram-sha-512") {
        kafkaConfig.sasl = {
          mechanism: "scram-sha-512",
          username: saslUsername,
          password: saslPassword,
        };
      }
    }

    return new Kafka(kafkaConfig);
  }

  /** NestJS lifecycle: connect Kafka producer when the module initializes */
  async onModuleInit() {
    try {
      await this.producer.connect();
      this.connected = true;
      this.metrics?.setKafkaProducerConnected(true);
      this.logger.log("Kafka producer connected", "KafkaService");
    } catch (err) {
      this.metrics?.setKafkaProducerConnected(false);
      this.logger.error(
        `Kafka producer failed to connect: ${(err as Error).message}`,
        (err as Error).stack,
        "KafkaService",
      );
    }
  }

  /** NestJS lifecycle: gracefully disconnect on application shutdown */
  async onModuleDestroy() {
    await this.producer.disconnect();
    this.connected = false;
    this.metrics?.setKafkaProducerConnected(false);
    for (const consumer of this.consumers.values()) {
      await consumer.disconnect();
    }
    this.logger.log("Kafka disconnected", "KafkaService");
  }

  /** Check if the producer is currently connected */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Publish an event to a Kafka topic.
   * If a Zod schema exists for the topic, the payload is validated first.
   * @param topic   - One of the topics defined in kafka/topics.ts
   * @param payload - Arbitrary JSON-serializable data
   * @param key     - Optional partition key (e.g. tribeId) for ordering
   * @throws Error if payload fails Zod validation
   */
  async publish(
    topic: string,
    payload: Record<string, unknown>,
    key?: string,
  ): Promise<void> {
    const physicalTopic = withTopicPrefix(topic, this.config.kafka.topicPrefix);

    try {
      // ---- Schema validation ----
      const schema = TOPIC_SCHEMAS[topic];
      if (schema) {
        const result = schema.safeParse(payload);
        if (!result.success) {
          const errorMsg = `Kafka schema validation failed for topic '${topic}': ${result.error.message}`;
          this.logger.error(errorMsg, undefined, "KafkaService");
          throw new Error(errorMsg);
        }
      }

      await this.producer.send({
        topic: physicalTopic,
        messages: [
          {
            key: key ? String(key) : undefined,
            value: JSON.stringify({
              ...payload,
              _meta: {
                timestamp: new Date().toISOString(),
                source: this.config.kafka.clientId,
              },
            }),
          },
        ],
      });
      this.metrics?.recordKafkaPublish(physicalTopic, "success");
    } catch (err) {
      this.metrics?.recordKafkaPublish(physicalTopic, "failure");
      this.gatewayTraffic
        ?.recordKafkaPublishFailure(physicalTopic)
        .catch(() => undefined);
      this.auditEvents
        ?.record({
          type: "kafka.publish_failed",
          severity: "error",
          message: `Kafka publish failed for ${physicalTopic}`,
          payload: {
            topic: physicalTopic,
            baseTopic: topic,
            error: (err as Error).message,
          },
        })
        .catch(() => undefined);
      throw err;
    }
  }

  async publishPhysicalTopic(
    topic: string,
    payload: Record<string, unknown>,
    key?: string,
  ): Promise<void> {
    const physicalTopic = topic.trim();

    try {
      await this.producer.send({
        topic: physicalTopic,
        messages: [
          {
            key: key ? String(key) : undefined,
            value: JSON.stringify({
              ...payload,
              _meta: {
                timestamp: new Date().toISOString(),
                source: this.config.kafka.clientId,
              },
            }),
          },
        ],
      });
      this.metrics?.recordKafkaPublish(physicalTopic, "success");
    } catch (err) {
      this.metrics?.recordKafkaPublish(physicalTopic, "failure");
      this.gatewayTraffic
        ?.recordKafkaPublishFailure(physicalTopic)
        .catch(() => undefined);
      this.auditEvents
        ?.record({
          type: "kafka.publish_failed",
          severity: "error",
          message: `Kafka publish failed for ${physicalTopic}`,
          payload: {
            topic: physicalTopic,
            baseTopic: topic,
            error: (err as Error).message,
          },
        })
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * Fire-and-forget publish for request-path events. Failures are logged and
   * intentionally not rethrown so primary request flow remains unaffected.
   */
  publishNonBlocking(
    topic: string,
    payload: Record<string, unknown>,
    options?: {
      key?: string;
      context?: string;
      failureLogLevel?: "debug" | "warn";
    },
  ): void {
    const {
      key,
      context = "KafkaService",
      failureLogLevel = "debug",
    } = options || {};
    const physicalTopic = withTopicPrefix(topic, this.config.kafka.topicPrefix);

    void this.publish(topic, payload, key).catch((err) => {
      const message = `Kafka publish failed for ${physicalTopic} (non-blocking): ${(err as Error).message}`;
      if (failureLogLevel === "warn") {
        this.logger.warn(message, context);
        return;
      }
      this.logger.debug(message, context);
    });
  }

  /**
   * Subscribe a handler function to a Kafka topic.
   * Creates a dedicated consumer per topic.
   */
  async subscribe(
    topic: string,
    handler: (message: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    const physicalTopic = withTopicPrefix(topic, this.config.kafka.topicPrefix);
    const consumer = this.kafka.consumer({
      groupId: `${this.config.kafka.groupId}-${physicalTopic}`,
    });

    await consumer.connect();
    await consumer.subscribe({ topic: physicalTopic, fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const parsed = JSON.parse(message.value?.toString() || "{}");
          await handler(parsed);
        } catch (err) {
          this.logger.error(
            `Kafka message processing error on ${topic}: ${(err as Error).message}`,
            (err as Error).stack,
            "KafkaService",
          );
        }
      },
    });

    this.consumers.set(physicalTopic, consumer);
    this.logger.log(
      `Kafka subscribed to topic: ${physicalTopic}`,
      "KafkaService",
    );
  }
}
