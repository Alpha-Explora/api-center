import { AuditEventsService } from "../analytics/audit-events.service";
import { TopicOnboardingStateRecord } from "./topic-onboarding-state.dto";
import { TopicOnboardingStateService } from "./topic-onboarding-state.service";

describe("TopicOnboardingStateService", () => {
  it("stores topic onboarding records in memory when database mode is off", async () => {
    const auditEvents = makeAuditEvents();
    const service = new TopicOnboardingStateService(
      undefined,
      auditEvents as unknown as AuditEventsService,
    );
    const record = makeRecord();

    await expect(
      service.upsert(
        "test.tribe.logistics.events",
        record,
        "operator",
        "corr-123",
      ),
    ).resolves.toEqual(record);

    await expect(service.get("test.tribe.logistics.events")).resolves.toEqual(
      record,
    );
    expect(auditEvents.recordRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.topic.provision_requested",
        actionFamily: "runtime",
        actor: "operator",
        serviceId: "logistics-orders",
        resourceType: "event_topic",
        resourceId: "test.tribe.logistics.events",
        environment: "test",
        correlationId: "corr-123",
      }),
    );
    expect(auditEvents.recordRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.sink.binding_created",
        actionFamily: "runtime",
        actor: "operator",
        resourceType: "data_sink",
        resourceId: "test.tribe.logistics.events",
        environment: "test",
        correlationId: "corr-123",
      }),
    );
  });

  it("records provisioned topic evidence when onboarding state is provisioned", async () => {
    const auditEvents = makeAuditEvents();
    const service = new TopicOnboardingStateService(
      undefined,
      auditEvents as unknown as AuditEventsService,
    );
    const record = makeRecord({
      current_state: "Topic provisioned",
      connector_name: "logistics-orders-s3-sink",
    });

    await service.upsert("test.tribe.logistics.events", record, "operator");

    expect(auditEvents.recordRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.topic.provisioned",
        resourceType: "event_topic",
        resourceId: "test.tribe.logistics.events",
      }),
    );
    expect(auditEvents.recordRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.sink.binding_created",
        resourceType: "data_sink",
        resourceId: "logistics-orders-s3-sink",
      }),
    );
  });

  it("rejects mismatched route and record topics", async () => {
    const auditEvents = makeAuditEvents();
    const service = new TopicOnboardingStateService(
      undefined,
      auditEvents as unknown as AuditEventsService,
    );

    await expect(
      service.upsert("test.tribe.other.events", makeRecord(), "operator"),
    ).rejects.toThrow("record.physical_topic must match the route topic");
  });

  it("fails closed when required runtime audit cannot be recorded", async () => {
    const auditEvents = makeAuditEvents();
    auditEvents.recordRequired.mockRejectedValueOnce(
      new Error("audit unavailable"),
    );
    const service = new TopicOnboardingStateService(
      undefined,
      auditEvents as unknown as AuditEventsService,
    );

    await expect(
      service.upsert("test.tribe.logistics.events", makeRecord(), "operator"),
    ).rejects.toThrow("audit unavailable");
  });

  it("persists topic onboarding records through Prisma when database mode is enabled", async () => {
    const auditEvents = makeAuditEvents();
    const prisma = {
      eventTopicOnboardingState: {
        upsert: jest.fn(async () => ({
          physicalTopic: "test.tribe.logistics.events",
          environment: "test",
          ownerTribeId: "logistics",
          record: makeRecord(),
        })),
        findUnique: jest.fn(),
      },
    };
    const original = process.env.DATABASE_ENABLED;
    process.env.DATABASE_ENABLED = "true";
    const service = new TopicOnboardingStateService(
      prisma as never,
      auditEvents as unknown as AuditEventsService,
    );

    try {
      await expect(
        service.upsert("test.tribe.logistics.events", makeRecord(), "operator"),
      ).resolves.toMatchObject({
        physical_topic: "test.tribe.logistics.events",
      });
    } finally {
      if (original === undefined) delete process.env.DATABASE_ENABLED;
      else process.env.DATABASE_ENABLED = original;
    }

    expect(prisma.eventTopicOnboardingState.upsert).toHaveBeenCalledWith({
      where: { physicalTopic: "test.tribe.logistics.events" },
      create: {
        physicalTopic: "test.tribe.logistics.events",
        environment: "test",
        ownerTribeId: "logistics",
        record: makeRecord(),
        updatedBy: "operator",
      },
      update: {
        environment: "test",
        ownerTribeId: "logistics",
        record: makeRecord(),
        updatedBy: "operator",
      },
    });
    expect(auditEvents.recordRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.topic.provision_requested",
        actionFamily: "runtime",
      }),
    );
  });

  it("reads topic onboarding records through Prisma when database mode is enabled", async () => {
    const auditEvents = makeAuditEvents();
    const prisma = {
      eventTopicOnboardingState: {
        findUnique: jest.fn(async () => ({
          physicalTopic: "test.tribe.logistics.events",
          environment: "test",
          ownerTribeId: "logistics",
          record: makeRecord(),
        })),
        upsert: jest.fn(),
      },
    };
    const original = process.env.DATABASE_ENABLED;
    process.env.DATABASE_ENABLED = "true";
    const service = new TopicOnboardingStateService(
      prisma as never,
      auditEvents as unknown as AuditEventsService,
    );

    try {
      await expect(service.get("test.tribe.logistics.events")).resolves.toEqual(
        makeRecord(),
      );
    } finally {
      if (original === undefined) delete process.env.DATABASE_ENABLED;
      else process.env.DATABASE_ENABLED = original;
    }

    expect(prisma.eventTopicOnboardingState.findUnique).toHaveBeenCalledWith({
      where: { physicalTopic: "test.tribe.logistics.events" },
    });
  });
});

function makeAuditEvents() {
  return {
    recordRequired: jest.fn().mockResolvedValue(undefined),
  };
}

function makeRecord(
  overrides: Partial<TopicOnboardingStateRecord> = {},
): TopicOnboardingStateRecord {
  return {
    ...baseRecord(),
    ...overrides,
  };
}

function baseRecord(): TopicOnboardingStateRecord {
  return {
    service_id: "logistics-orders",
    canonical_service_id: "logistics-orders",
    owner_tribe_id: "logistics",
    canonical_tribe_id: "logistics",
    source_service_ids: ["logistics-orders"],
    environment: "test",
    source_system: "logistics",
    logical_topic: "tribe.logistics.events",
    physical_topic: "test.tribe.logistics.events",
    s3_prefix: "s3://api-center-raw-data/topics/test.tribe.logistics.events/",
    current_state: "Not configured",
    approved_reader_groups: [],
    exception_status: "none" as const,
    transition_history: [],
  };
}
