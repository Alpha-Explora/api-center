import { TopicOnboardingStateService } from "./topic-onboarding-state.service";

describe("TopicOnboardingStateService", () => {
  it("stores topic onboarding records in memory when database mode is off", async () => {
    const service = new TopicOnboardingStateService();
    const record = makeRecord();

    await expect(
      service.upsert("test.tribe.logistics.events", record, "operator"),
    ).resolves.toEqual(record);

    await expect(service.get("test.tribe.logistics.events")).resolves.toEqual(
      record,
    );
  });

  it("rejects mismatched route and record topics", async () => {
    const service = new TopicOnboardingStateService();

    await expect(
      service.upsert("test.tribe.other.events", makeRecord(), "operator"),
    ).rejects.toThrow("record.physical_topic must match the route topic");
  });

  it("persists topic onboarding records through Postgres when database mode is enabled", async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn(async () => [{ record: makeRecord() }]),
    };
    const original = process.env.DATABASE_ENABLED;
    process.env.DATABASE_ENABLED = "true";
    const service = new TopicOnboardingStateService(prisma as never);

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

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("api_center_ops.topic_onboarding_states"),
      "test.tribe.logistics.events",
      "test",
      "logistics",
      expect.stringContaining('"physical_topic":"test.tribe.logistics.events"'),
      "operator",
    );
  });
});

function makeRecord() {
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
