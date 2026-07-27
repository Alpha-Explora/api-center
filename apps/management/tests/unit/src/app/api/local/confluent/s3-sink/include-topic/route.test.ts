import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../../../../../../../src/app/api/local/confluent/s3-sink/include-topic/route";

const confluentMocks = vi.hoisted(() => ({
  includeConfluentTopicInS3Sink: vi.fn(),
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
  };
});

vi.mock("@/lib/server/topic-onboarding-state-store", () => topicStateMocks);

describe("POST /api/local/confluent/s3-sink/include-topic", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_LOCAL_MANAGEMENT_MODE;
    delete process.env.MANAGEMENT_ENVIRONMENT;
  });

  it("records connector evidence without advancing topic onboarding state optimistically", async () => {
    process.env.MANAGEMENT_ENVIRONMENT = "test";
    confluentMocks.includeConfluentTopicInS3Sink.mockResolvedValue({
      topicName: "test.tribe.logistics.events",
      connectorName: "api-center-test-s3-sink",
      updated: true,
      alreadyIncluded: false,
      topics: ["test.tribe.logistics.events"],
    });
    topicStateMocks.updateTopicOnboardingStateRecord.mockResolvedValue({});

    const response = await POST(
      new Request("http://localhost/api/local/confluent/s3-sink/include-topic", {
        method: "POST",
        body: JSON.stringify({
          topicName: "test.tribe.logistics.events",
          confirmation: {
            typedPhrase: "CONFIRM TEST PROVIDER WRITE",
            reason: "test",
          },
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        topicName: "test.tribe.logistics.events",
        connectorName: "api-center-test-s3-sink",
        updated: true,
        alreadyIncluded: false,
        topics: ["test.tribe.logistics.events"],
      },
    });
    expect(topicStateMocks.updateTopicOnboardingStateRecord).toHaveBeenCalledWith(
      "test.tribe.logistics.events",
      expect.objectContaining({
        serviceId: "logistics",
        actor: "local-dev@api-center.internal",
        evidenceLink: "confluent://s3-sink/api-center-test-s3-sink",
      }),
    );
    expect(
      topicStateMocks.updateTopicOnboardingStateRecord.mock.calls[0][1],
    ).not.toHaveProperty("stateInputs");
  });
});
