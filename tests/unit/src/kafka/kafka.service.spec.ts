import { KafkaService } from "../../../../src/kafka/kafka.service";
import { ConfigService } from "../../../../src/config/config.service";
import { LoggerService } from "../../../../src/shared/logger.service";
import { TOPICS, withTopicPrefix } from "../../../../src/kafka/topics";
import { MetricsService } from "../../../../src/metrics/metrics.service";

jest.mock("kafkajs", () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: (() => {
      const producer = {
        connect: jest.fn(),
        send: jest.fn(),
        disconnect: jest.fn(),
      };
      return () => producer;
    })(),
    consumer: (() => {
      const consumer = {
        connect: jest.fn(),
        subscribe: jest.fn(),
        run: jest.fn(),
        disconnect: jest.fn(),
      };
      return () => consumer;
    })(),
  })),
  logLevel: {
    WARN: 4,
  },
}));

describe("KafkaService", () => {
  const mockConfig = {
    kafka: {
      enabled: true,
      clientId: "api-center-test",
      brokers: ["pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092"],
      groupId: "api-center-group",
      sslEnabled: false,
      sslRejectUnauthorized: true,
      sslCaPem: "",
      saslMechanism: "",
      saslUsername: "",
      saslPassword: "",
    },
  } as unknown as ConfigService;

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService;

  const mockMetrics = {
    recordKafkaPublish: jest.fn(),
    setKafkaProducerConnected: jest.fn(),
  } as unknown as MetricsService;

  let mockProducer: {
    connect: jest.Mock;
    send: jest.Mock;
    disconnect: jest.Mock;
  };
  let mockConsumer: {
    connect: jest.Mock;
    subscribe: jest.Mock;
    run: jest.Mock;
    disconnect: jest.Mock;
  };
  let service: KafkaService;

  it("should normalize environment topic prefixes", () => {
    expect(withTopicPrefix("api-center.audit.log", "")).toBe(
      "api-center.audit.log",
    );
    expect(withTopicPrefix("api-center.audit.log", "test.")).toBe(
      "test.api-center.audit.log",
    );
    expect(withTopicPrefix("tribe.servease.events", "prod")).toBe(
      "prod.tribe.servease.events",
    );
    expect(withTopicPrefix("test.api-center.audit.log", "test.")).toBe(
      "test.api-center.audit.log",
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (mockConfig.kafka as { topicPrefix?: string }).topicPrefix = "";
    const kafkaModule = jest.requireMock("kafkajs") as {
      Kafka: jest.Mock;
    };

    service = new KafkaService(mockConfig, mockLogger, mockMetrics);

    const kafkaInstance = kafkaModule.Kafka.mock.results[0].value as {
      producer: () => {
        connect: jest.Mock;
        send: jest.Mock;
        disconnect: jest.Mock;
      };
      consumer: () => {
        connect: jest.Mock;
        subscribe: jest.Mock;
        run: jest.Mock;
        disconnect: jest.Mock;
      };
    };

    mockProducer = kafkaInstance.producer();
    mockConsumer = kafkaInstance.consumer();

    mockProducer.connect.mockResolvedValue(undefined);
    mockProducer.send.mockResolvedValue(undefined);
    mockProducer.disconnect.mockResolvedValue(undefined);
    mockConsumer.connect.mockResolvedValue(undefined);
    mockConsumer.subscribe.mockResolvedValue(undefined);
    mockConsumer.run.mockResolvedValue(undefined);
    mockConsumer.disconnect.mockResolvedValue(undefined);
  });

  it("should mark producer as connected after successful module init", async () => {
    await service.onModuleInit();

    expect(service.isConnected()).toBe(true);
    expect(mockProducer.connect).toHaveBeenCalledTimes(1);
    expect(mockMetrics.setKafkaProducerConnected).toHaveBeenCalledWith(true);
  });

  it("should keep producer disconnected when module init connect fails", async () => {
    mockProducer.connect.mockRejectedValue(new Error("connect-failed"));

    await service.onModuleInit();

    expect(service.isConnected()).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockMetrics.setKafkaProducerConnected).toHaveBeenCalledWith(false);
  });

  it("should not create a Kafka client or connect the producer when Kafka is disabled", async () => {
    const kafkaModule = jest.requireMock("kafkajs") as {
      Kafka: jest.Mock;
    };
    kafkaModule.Kafka.mockClear();

    const disabledConfig = {
      kafka: {
        ...mockConfig.kafka,
        enabled: false,
      },
    } as unknown as ConfigService;

    const disabledService = new KafkaService(
      disabledConfig,
      mockLogger,
      mockMetrics,
    );

    await disabledService.onModuleInit();

    expect(kafkaModule.Kafka).not.toHaveBeenCalled();
    expect(disabledService.isConnected()).toBe(false);
    expect(mockMetrics.setKafkaProducerConnected).toHaveBeenCalledWith(false);
  });

  it("should reject explicit publish when Kafka is disabled", async () => {
    const disabledConfig = {
      kafka: {
        ...mockConfig.kafka,
        enabled: false,
      },
    } as unknown as ConfigService;
    const disabledService = new KafkaService(
      disabledConfig,
      mockLogger,
      mockMetrics,
    );

    await expect(
      disabledService.publish("custom.topic", { event: "blocked" }),
    ).rejects.toThrow("Kafka publishing is disabled");
  });

  it("should no-op non-blocking publish when Kafka is disabled", async () => {
    const disabledConfig = {
      kafka: {
        ...mockConfig.kafka,
        enabled: false,
      },
    } as unknown as ConfigService;
    const disabledService = new KafkaService(
      disabledConfig,
      mockLogger,
      mockMetrics,
    );

    disabledService.publishNonBlocking("custom.topic", { event: "ignored" });
    await Promise.resolve();

    expect(mockProducer.send).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Kafka publishing disabled"),
      "KafkaService",
    );
  });

  it("should configure Kafka client with TLS and SASL when enabled", () => {
    const kafkaModule = jest.requireMock("kafkajs") as {
      Kafka: jest.Mock;
    };

    kafkaModule.Kafka.mockClear();

    const secureConfig = {
      kafka: {
        clientId: "api-center-test",
        brokers: ["pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092"],
        groupId: "api-center-group",
        sslEnabled: true,
        sslRejectUnauthorized: true,
        sslCaPem: "",
        saslMechanism: "plain",
        saslUsername: "confluent-key",
        saslPassword: "secret",
      },
    } as unknown as ConfigService;

    new KafkaService(secureConfig, mockLogger, mockMetrics);

    expect(kafkaModule.Kafka).toHaveBeenCalledWith(
      expect.objectContaining({
        ssl: true,
        sasl: {
          mechanism: "plain",
          username: "confluent-key",
          password: "secret",
        },
      }),
    );
  });

  it("should configure Kafka client with CA bundle when provided", () => {
    const kafkaModule = jest.requireMock("kafkajs") as {
      Kafka: jest.Mock;
    };

    kafkaModule.Kafka.mockClear();

    const secureConfig = {
      kafka: {
        clientId: "api-center-test",
        brokers: ["pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092"],
        groupId: "api-center-group",
        sslEnabled: true,
        sslRejectUnauthorized: true,
        sslCaPem: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----",
        saslMechanism: "plain",
        saslUsername: "confluent-key",
        saslPassword: "secret",
      },
    } as unknown as ConfigService;

    new KafkaService(secureConfig, mockLogger, mockMetrics);

    expect(kafkaModule.Kafka).toHaveBeenCalledWith(
      expect.objectContaining({
        ssl: {
          rejectUnauthorized: true,
          ca: ["-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----"],
        },
      }),
    );
  });

  it("should reject publish when payload fails topic schema validation", async () => {
    await expect(service.publish(TOPICS.GATEWAY_REQUEST, {})).rejects.toThrow(
      "Kafka schema validation failed",
    );
    expect(mockProducer.send).not.toHaveBeenCalled();
    expect(mockMetrics.recordKafkaPublish).toHaveBeenCalledWith(
      TOPICS.GATEWAY_REQUEST,
      "failure",
    );
  });

  it("should reject token-issued events when required schema fields are missing", async () => {
    await expect(
      service.publish(TOPICS.TOKEN_ISSUED, {
        tribeId: "svc-alpha",
        sub: "svc-alpha",
      }),
    ).rejects.toThrow("Kafka schema validation failed");
  });

  it("should reject shared-service export events when required schema fields are missing", async () => {
    await expect(
      service.publish(TOPICS.SHARED_SMS_EVENTS, {
        eventId: "evt_123",
        tribeId: "svc-alpha",
      }),
    ).rejects.toThrow("Kafka schema validation failed");
  });

  it("should publish payload with source metadata and key", async () => {
    await service.publish("custom.topic", { event: "ok" }, "tribe-a");

    expect(mockProducer.send).toHaveBeenCalledWith({
      topic: "custom.topic",
      messages: [
        {
          key: "tribe-a",
          value: expect.any(String),
        },
      ],
    });

    const sentPayload = JSON.parse(
      mockProducer.send.mock.calls[0][0].messages[0].value,
    );
    expect(sentPayload.event).toBe("ok");
    expect(sentPayload._meta.source).toBe("api-center-test");
    expect(sentPayload._meta.timestamp).toEqual(expect.any(String));
    expect(mockMetrics.recordKafkaPublish).toHaveBeenCalledWith(
      "custom.topic",
      "success",
    );
  });

  it("should publish to environment-prefixed Kafka topics", async () => {
    (mockConfig.kafka as { topicPrefix?: string }).topicPrefix = "test.";

    await service.publish("custom.topic", { event: "ok" }, "tribe-a");

    expect(mockProducer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "test.custom.topic",
      }),
    );
    expect(mockMetrics.recordKafkaPublish).toHaveBeenCalledWith(
      "test.custom.topic",
      "success",
    );
  });

  it("should publish to an exact physical topic without applying the configured prefix", async () => {
    (mockConfig.kafka as { topicPrefix?: string }).topicPrefix = "prod.";

    await service.publishPhysicalTopic(
      "test.api-center.pipeline.athena-query-execution",
      { event: "ok" },
      "api-center-platform-validation-test",
    );

    expect(mockProducer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "test.api-center.pipeline.athena-query-execution",
      }),
    );
    expect(mockMetrics.recordKafkaPublish).toHaveBeenCalledWith(
      "test.api-center.pipeline.athena-query-execution",
      "success",
    );
  });

  it("should publish audit events when payload satisfies audit schema", async () => {
    await service.publish(TOPICS.AUDIT_LOG, {
      tribeId: "svc-alpha",
      method: "GET",
      path: "/api/v1/tribes/svc-alpha",
      statusCode: 200,
      durationMs: 15,
      ip: "127.0.0.1",
      correlationId: "corr-1",
    });

    expect(mockProducer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: TOPICS.AUDIT_LOG }),
    );
  });

  it("should disconnect producer and consumers on module destroy", async () => {
    (service as any).consumers.set("topic-a", mockConsumer);

    await service.onModuleDestroy();

    expect(mockProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(service.isConnected()).toBe(false);
    expect(mockMetrics.setKafkaProducerConnected).toHaveBeenCalledWith(false);
  });

  it("should keep request flow non-blocking when publish fails", async () => {
    mockProducer.send.mockRejectedValue(new Error("kafka-down"));

    service.publishNonBlocking("custom.topic", { event: "non-blocking" });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Kafka publish failed for custom.topic"),
      "KafkaService",
    );
    expect(mockMetrics.recordKafkaPublish).toHaveBeenCalledWith(
      "custom.topic",
      "failure",
    );
  });

  it("should log warn when non-blocking publish is configured with warn level", async () => {
    mockProducer.send.mockRejectedValue(new Error("kafka-down"));

    service.publishNonBlocking(
      "custom.topic",
      { event: "warn-level" },
      {
        context: "ExternalService",
        failureLogLevel: "warn",
      },
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Kafka publish failed for custom.topic"),
      "ExternalService",
    );
  });
});
