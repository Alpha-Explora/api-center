import { ConfigService } from "../config/config.service";
import { EventSchemaRegistryService } from "../data-pipeline/event-schema-registry.service";
import { KafkaService } from "../kafka/kafka.service";
import { MetricsService } from "../metrics/metrics.service";
import { ForbiddenError, ValidationError } from "../shared/errors";
import { LoggerService } from "../shared/logger.service";
import { KafkaGovernanceService } from "./kafka-governance.service";

describe("KafkaGovernanceService", () => {
  const mockKafka = {
    publish: jest.fn().mockResolvedValue(undefined),
  } as unknown as KafkaService;

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
  } as unknown as LoggerService;

  const mockMetrics = {
    recordKafkaGovernanceOperation: jest.fn(),
  } as unknown as MetricsService;

  const mockEventSchemaRegistry = {
    validateEvent: jest.fn(),
  } as unknown as EventSchemaRegistryService;

  let service: KafkaGovernanceService;

  const createService = (topicPrefix = "") =>
    new KafkaGovernanceService(
      mockKafka,
      mockLogger,
      mockMetrics,
      {
        kafka: { topicPrefix },
      } as ConfigService,
      mockEventSchemaRegistry,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    (mockEventSchemaRegistry.validateEvent as jest.Mock).mockResolvedValue({
      accepted: true,
      schemaValidationStatus: "approved",
      schemaRegistryVersion: "fixture-registry-v1",
    });
    service = createService();
  });

  it("publishes governed messages to tenant-scoped topics", async () => {
    await service.publishMessage(
      "orders-service",
      {
        topic: "tribe.orders-service.events",
        eventType: "order.created",
        payload: { orderId: "ord_123" },
      },
      "corr-1",
    );

    expect(mockKafka.publish).toHaveBeenCalledWith(
      "tribe.orders-service.events",
      expect.objectContaining({
        eventType: "order.created",
        payload: { orderId: "ord_123" },
        governance: expect.objectContaining({
          sourceTribeId: "orders-service",
          correlationId: "corr-1",
          eventSchemaVersion: "1.0.0",
          schemaValidationStatus: "approved",
          schemaRegistryVersion: "fixture-registry-v1",
        }),
      }),
      "orders-service",
    );
  });

  it("validates event schema before publishing and returns validation evidence", async () => {
    const result = await service.publishMessage(
      "orders-service",
      {
        topic: "tribe.orders-service.events",
        eventType: "order.created",
        schemaVersion: "1.0.0",
        payload: { orderId: "ord_123" },
      },
      "corr-1",
    );

    expect(mockEventSchemaRegistry.validateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "test",
        tribeId: "orders-service",
        eventType: "order.created",
        schemaVersion: "1.0.0",
        payload: { orderId: "ord_123" },
        allowTestDiscovery: true,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        schemaValidationStatus: "approved",
        schemaRegistryVersion: "fixture-registry-v1",
      }),
    );
  });

  it("publishes tribe events with source service attribution", async () => {
    await service.publishMessage(
      "logistics",
      {
        topic: "tribe.logistics.events",
        key: "ord_123",
        eventType: "order.created",
        payload: { orderId: "ord_123" },
        sourceServiceId: "logistics-orders",
        metadata: { schema: "orders.v1" },
      },
      "corr-1",
    );

    expect(mockKafka.publish).toHaveBeenCalledWith(
      "tribe.logistics.events",
      expect.objectContaining({
        eventType: "order.created",
        payload: { orderId: "ord_123" },
        metadata: { schema: "orders.v1" },
        governance: expect.objectContaining({
          sourceTribeId: "logistics",
          sourceServiceId: "logistics-orders",
          correlationId: "corr-1",
        }),
      }),
      "ord_123",
    );
  });

  it("accepts a prod-prefixed tenant topic when prod is the configured runtime prefix", async () => {
    service = createService("prod.");

    await service.publishMessage("flow-ci", {
      topic: "prod.tribe.flow-ci.events",
      eventType: "build.completed",
      payload: { buildId: "build_123" },
    });

    expect(mockKafka.publish).toHaveBeenCalledWith(
      "prod.tribe.flow-ci.events",
      expect.objectContaining({
        eventType: "build.completed",
        governance: expect.objectContaining({
          sourceTribeId: "flow-ci",
        }),
      }),
      "flow-ci",
    );
  });

  it("accepts a test-prefixed tenant topic when test is the configured runtime prefix", async () => {
    service = createService("test.");

    await service.publishMessage("flow-ci", {
      topic: "test.tribe.flow-ci.events",
      eventType: "build.completed",
      payload: { buildId: "build_123" },
    });

    expect(mockKafka.publish).toHaveBeenCalledWith(
      "test.tribe.flow-ci.events",
      expect.objectContaining({
        eventType: "build.completed",
        governance: expect.objectContaining({
          sourceTribeId: "flow-ci",
        }),
      }),
      "flow-ci",
    );
  });

  it("allows test discovery events when registry policy accepts them", async () => {
    service = createService("test.");
    (mockEventSchemaRegistry.validateEvent as jest.Mock).mockResolvedValue({
      accepted: true,
      schemaValidationStatus: "test_discovery",
      schemaRegistryVersion: "fixture-registry-v1",
    });

    await service.publishMessage("flow-ci", {
      topic: "test.tribe.flow-ci.events",
      eventType: "build.experimental.completed",
      payload: { buildId: "build_123" },
    });

    expect(mockKafka.publish).toHaveBeenCalledWith(
      "test.tribe.flow-ci.events",
      expect.objectContaining({
        governance: expect.objectContaining({
          schemaValidationStatus: "test_discovery",
          schemaRegistryVersion: "fixture-registry-v1",
        }),
      }),
      "flow-ci",
    );
  });

  it("rejects unapproved production event schemas before publishing", async () => {
    service = createService("prod.");
    (mockEventSchemaRegistry.validateEvent as jest.Mock).mockResolvedValue({
      accepted: false,
      schemaValidationStatus: "rejected",
      schemaRegistryVersion: "fixture-registry-v1",
      schemaValidationError: "No approved schema registered",
    });

    await expect(
      service.publishMessage("flow-ci", {
        topic: "prod.tribe.flow-ci.events",
        eventType: "build.experimental.completed",
        payload: { buildId: "build_123" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(mockKafka.publish).not.toHaveBeenCalled();
    expect(mockMetrics.recordKafkaGovernanceOperation).toHaveBeenCalledWith(
      "publish",
      "failure",
    );
  });

  it("rejects source service attempts to publish outside the tribe topic", async () => {
    await expect(
      service.publishMessage("logistics", {
        topic: "tribe.logistics-orders.events",
        eventType: "order.created",
        payload: { orderId: "ord_123" },
        sourceServiceId: "logistics-orders",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects prefixed source service attempts to publish outside the owner tribe topic", async () => {
    service = createService("prod.");

    await expect(
      service.publishMessage("logistics", {
        topic: "prod.tribe.logistics-orders.events",
        eventType: "order.created",
        payload: { orderId: "ord_123" },
        sourceServiceId: "logistics-orders",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects publish to non-tenant topic", async () => {
    await expect(
      service.publishMessage("orders-service", {
        topic: "tribe.payments.events",
        eventType: "order.created",
        payload: { orderId: "ord_123" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects prefixed cross-tenant topics", async () => {
    service = createService("prod.");

    await expect(
      service.publishMessage("flow-ci", {
        topic: "prod.tribe.other.events",
        eventType: "build.completed",
        payload: { buildId: "build_123" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects publish to reserved topics", async () => {
    await expect(
      service.publishMessage("orders-service", {
        topic: "__consumer_offsets",
        eventType: "order.created",
        payload: { orderId: "ord_123" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects prefixed reserved operational topics", async () => {
    service = createService("prod.");

    await expect(
      service.publishMessage("orders-service", {
        topic: "prod.api-center.audit.log",
        eventType: "audit.test",
        payload: { auditId: "audit_123" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects invalid governed payloads", async () => {
    await expect(
      service.publishMessage("orders-service", {
        topic: "tribe.orders-service.events",
        eventType: "order.created",
        payload: null as unknown as Record<string, unknown>,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns governance topic recommendations for a tribe", () => {
    const result = service.getGovernanceCatalog("Orders Service");

    expect(result.tenantTopicPrefix).toBe("tribe.orders-service.");
    expect(result.recommendedTopics).toContain("tribe.orders-service.events");
  });
});
