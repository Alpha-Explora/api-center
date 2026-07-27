import { afterEach, describe, expect, it } from "vitest";
import { planTopicMigration } from "../../../../src/lib/topic-migration";

describe("planTopicMigration", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX;
  });

  it("plans service topic migration into the owner tribe topic", () => {
    expect(
      planTopicMigration({
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
        serviceType: "tribe",
      }),
    ).toEqual({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      legacyTopic: "tribe.logistics-orders.events",
      targetTopic: "tribe.logistics.events",
      migrationNeeded: true,
      reason:
        "Service topic tribe.logistics-orders.events should move to tribe topic tribe.logistics.events.",
    });
  });

  it("does not migrate entries that are already tribe principals", () => {
    expect(
      planTopicMigration({
        serviceId: "logistics",
        ownerTribeId: "logistics",
        serviceType: "tribe",
      }).migrationNeeded,
    ).toBe(false);
  });

  it("uses environment prefixes consistently", () => {
    process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX = "prod";

    const plan = planTopicMigration({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      serviceType: "tribe",
    });

    expect(plan.legacyTopic).toBe("prod.tribe.logistics-orders.events");
    expect(plan.targetTopic).toBe("prod.tribe.logistics.events");
  });

  it("normalizes the owner tribe when planning service topic migration", () => {
    const plan = planTopicMigration({
      serviceId: "flow-ci-api",
      ownerTribeId: "Flow CI",
      serviceType: "tribe",
    });

    expect(plan.legacyTopic).toBe("tribe.flow-ci-api.events");
    expect(plan.targetTopic).toBe("tribe.flow-ci.events");
  });
});
