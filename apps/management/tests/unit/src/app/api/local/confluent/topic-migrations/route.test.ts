import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../../../../../../src/app/api/local/confluent/topic-migrations/route";

const confluentMocks = vi.hoisted(() => ({
  includeConfluentTopicInS3Sink: vi.fn(),
  provisionConfluentTopic: vi.fn(),
}));

const topicStateMocks = vi.hoisted(() => ({
  updateTopicOnboardingStateRecord: vi.fn(),
}));

vi.mock("@/lib/server/confluent-cloud", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/confluent-cloud")>(
    "@/lib/server/confluent-cloud",
  );

  return {
    ...actual,
    includeConfluentTopicInS3Sink:
      confluentMocks.includeConfluentTopicInS3Sink,
    provisionConfluentTopic: confluentMocks.provisionConfluentTopic,
  };
});

vi.mock("@/lib/server/topic-onboarding-state-store", () => topicStateMocks);

describe("POST /api/local/confluent/topic-migrations", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_LOCAL_MANAGEMENT_MODE;
    delete process.env.MANAGEMENT_ENVIRONMENT;
    delete process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX;
  });

  it("prepares the owner tribe topic and keeps the legacy service topic", async () => {
    process.env.MANAGEMENT_ENVIRONMENT = "test";
    confluentMocks.provisionConfluentTopic.mockResolvedValue({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      topicName: "tribe.logistics.events",
      clusterId: "lkc-test",
      created: true,
      existed: false,
      partitions: 1,
      retentionMs: 604800000,
    });
    confluentMocks.includeConfluentTopicInS3Sink.mockResolvedValue({
      topicName: "tribe.logistics.events",
      connectorName: "api-center-test-s3-sink",
      updated: true,
      alreadyIncluded: false,
      topics: ["tribe.logistics.events"],
    });
    topicStateMocks.updateTopicOnboardingStateRecord.mockResolvedValue({});

    const response = await POST(
      new Request("http://localhost/api/local/confluent/topic-migrations", {
        method: "POST",
        body: JSON.stringify({
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
        legacyTopic: "tribe.logistics-orders.events",
        targetTopic: "tribe.logistics.events",
        migrationNeeded: true,
        topicProvisioned: true,
        sinkIncluded: true,
        oldTopicPreserved: true,
      },
    });
    expect(confluentMocks.provisionConfluentTopic).toHaveBeenCalledWith({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      topicName: "tribe.logistics.events",
      partitions: 1,
    });
    expect(confluentMocks.includeConfluentTopicInS3Sink).toHaveBeenCalledWith(
      "tribe.logistics.events",
    );
    expect(topicStateMocks.updateTopicOnboardingStateRecord).toHaveBeenCalledWith(
      "tribe.logistics.events",
      expect.objectContaining({
        serviceId: "logistics-orders",
        actor: "local-dev@api-center.internal",
        evidenceLink: "confluent://topic-migration/tribe.logistics.events",
      }),
    );
  });

  it("rejects topic migration when local management routes are disabled", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MANAGEMENT_MODE = "false";

    const response = await POST(
      new Request("http://localhost/api/local/confluent/topic-migrations", {
        method: "POST",
        body: JSON.stringify({
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Local management routes are disabled.",
    });
    expect(confluentMocks.provisionConfluentTopic).not.toHaveBeenCalled();
  });

  it("uses the configured test topic prefix for owner tribe migrations", async () => {
    process.env.MANAGEMENT_ENVIRONMENT = "test";
    process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX = "test";
    confluentMocks.provisionConfluentTopic.mockResolvedValue({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      topicName: "test.tribe.logistics.events",
      clusterId: "lkc-test",
      created: false,
      existed: true,
      partitions: 1,
      retentionMs: 604800000,
    });
    confluentMocks.includeConfluentTopicInS3Sink.mockResolvedValue({
      topicName: "test.tribe.logistics.events",
      connectorName: "api-center-test-s3-sink",
      updated: false,
      alreadyIncluded: true,
      topics: ["test.tribe.logistics.events"],
    });
    topicStateMocks.updateTopicOnboardingStateRecord.mockResolvedValue({});

    const response = await POST(
      new Request("http://localhost/api/local/confluent/topic-migrations", {
        method: "POST",
        body: JSON.stringify({
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
        legacyTopic: "test.tribe.logistics-orders.events",
        targetTopic: "test.tribe.logistics.events",
        migrationNeeded: true,
        topicProvisioned: true,
        sinkIncluded: true,
        oldTopicPreserved: true,
      },
    });
    expect(confluentMocks.provisionConfluentTopic).toHaveBeenCalledWith({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      topicName: "test.tribe.logistics.events",
      partitions: 1,
    });
    expect(confluentMocks.includeConfluentTopicInS3Sink).toHaveBeenCalledWith(
      "test.tribe.logistics.events",
    );
    expect(topicStateMocks.updateTopicOnboardingStateRecord).toHaveBeenCalledWith(
      "test.tribe.logistics.events",
      expect.objectContaining({
        serviceId: "logistics-orders",
        evidenceLink: "confluent://topic-migration/test.tribe.logistics.events",
      }),
    );
  });
});
