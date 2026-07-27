import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../../../../../../../src/app/api/local/confluent/s3-sink/remove-topic/route";

const confluentMocks = vi.hoisted(() => ({
  removeConfluentTopicFromS3Sink: vi.fn(),
}));

vi.mock("@/lib/server/confluent-cloud", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/confluent-cloud")>(
    "@/lib/server/confluent-cloud",
  );

  return {
    ...actual,
    removeConfluentTopicFromS3Sink:
      confluentMocks.removeConfluentTopicFromS3Sink,
  };
});

describe("POST /api/local/confluent/s3-sink/remove-topic", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_LOCAL_MANAGEMENT_MODE;
  });

  it("honors the local management mode kill switch", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MANAGEMENT_MODE = "false";

    const response = await POST(
      new Request("http://localhost/api/local/confluent/s3-sink/remove-topic", {
        method: "POST",
        body: JSON.stringify({ topicName: "test.tribe.campus-one.events" }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Local management routes are disabled.",
    });
    expect(response.status).toBe(403);
    expect(confluentMocks.removeConfluentTopicFromS3Sink).not.toHaveBeenCalled();
  });
});
