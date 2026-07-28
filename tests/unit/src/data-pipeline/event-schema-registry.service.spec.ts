import { EventSchemaRegistryService } from "../../../../apps/gateway/src/data-pipeline/event-schema-registry.service";

describe("EventSchemaRegistryService", () => {
  const approvedRecord = {
    tribeId: "orders",
    eventType: "order.created",
    schemaVersion: "1.0.0",
    environment: "live" as const,
    physicalEnvironment: "prod" as const,
    owner: "orders-platform",
    steward: "orders-data-steward",
    jsonSchema: {
      type: "object" as const,
      required: ["orderId"],
      properties: {
        orderId: { type: "string" },
      },
    },
    compatibilityMode: "backward" as const,
    status: "approved" as const,
    approvedBy: "api-center-governance",
    approvedAt: "2026-05-21T00:00:00.000Z",
  };

  it("accepts a known approved event type and schema version", async () => {
    const service = new EventSchemaRegistryService({
      records: [approvedRecord],
      registryVersion: "fixture-registry-v1",
    });

    await expect(
      service.validateEvent({
        environment: "live",
        tribeId: "orders",
        eventType: "order.created",
        schemaVersion: "1.0.0",
        payload: { orderId: "ord_123" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        accepted: true,
        schemaValidationStatus: "approved",
        schemaRegistryVersion: "fixture-registry-v1",
        record: expect.objectContaining({
          environment: "live",
          physicalEnvironment: "prod",
          eventType: "order.created",
          schemaVersion: "1.0.0",
        }),
      }),
    );
  });

  it("maps public live validation to physical prod registry records", async () => {
    const service = new EventSchemaRegistryService({
      records: [approvedRecord],
      registryVersion: "fixture-registry-v1",
    });

    await expect(
      service.validateEvent({
        environment: "live",
        tribeId: "orders",
        eventType: "order.created",
        schemaVersion: "1.0.0",
        payload: { orderId: "ord_123" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        accepted: true,
        record: expect.objectContaining({
          environment: "live",
          physicalEnvironment: "prod",
        }),
      }),
    );
  });

  it("rejects an unknown production event type", async () => {
    const service = new EventSchemaRegistryService({
      records: [approvedRecord],
      registryVersion: "fixture-registry-v1",
    });

    await expect(
      service.validateEvent({
        environment: "live",
        tribeId: "orders",
        eventType: "order.cancelled",
        schemaVersion: "1.0.0",
        payload: { orderId: "ord_123" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        accepted: false,
        schemaValidationStatus: "rejected",
        schemaRegistryVersion: "fixture-registry-v1",
        schemaValidationError: expect.stringContaining(
          "No approved schema registered",
        ),
      }),
    );
  });

  it("allows unknown test events only when discovery policy is enabled", async () => {
    const service = new EventSchemaRegistryService({
      records: [],
      allowTestDiscovery: true,
      registryVersion: "fixture-registry-v1",
    });

    await expect(
      service.validateEvent({
        environment: "test",
        tribeId: "orders",
        eventType: "order.experiment.started",
        schemaVersion: "0.1.0",
        payload: { experimentId: "exp_123" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        accepted: true,
        schemaValidationStatus: "test_discovery",
        schemaRegistryVersion: "fixture-registry-v1",
      }),
    );

    const lockedService = new EventSchemaRegistryService({
      records: [],
      allowTestDiscovery: false,
      registryVersion: "fixture-registry-v1",
    });

    await expect(
      lockedService.validateEvent({
        environment: "test",
        tribeId: "orders",
        eventType: "order.experiment.started",
        schemaVersion: "0.1.0",
        payload: { experimentId: "exp_123" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        accepted: false,
        schemaValidationStatus: "rejected",
      }),
    );
  });

  it("rejects a schema version that has not been approved", async () => {
    const pendingRecord = {
      ...approvedRecord,
      schemaVersion: "2.0.0",
      status: "pending_approval" as const,
      approvedBy: undefined,
      approvedAt: undefined,
    };
    const service = new EventSchemaRegistryService({
      records: [approvedRecord, pendingRecord],
      registryVersion: "fixture-registry-v2",
    });

    await expect(
      service.validateEvent({
        environment: "live",
        tribeId: "orders",
        eventType: "order.created",
        schemaVersion: "2.0.0",
        payload: { orderId: "ord_123" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        accepted: false,
        schemaValidationStatus: "rejected",
        schemaValidationError: expect.stringContaining("pending_approval"),
      }),
    );
  });
});