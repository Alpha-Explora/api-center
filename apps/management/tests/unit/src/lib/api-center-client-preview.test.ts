import { afterEach, describe, expect, it, vi } from "vitest";
import {
  previewApiCenterDeploymentRestart,
  previewConfluentS3SinkRemoveTopic,
  previewTribeSecretProvision,
  setManagementSessionToken,
} from "../../../../src/lib/api-center-client";

const previewResponse = {
  preview: {
    actionId: "test.action",
    environment: "test",
    risk: "provider-write",
    changes: ["planned change"],
    reasonRequired: false,
  },
};

describe("api-center-client preview calls", () => {
  afterEach(() => {
    setManagementSessionToken(undefined);
    vi.restoreAllMocks();
  });

  it("sends tribe secret preview requests without exposing plaintext", async () => {
    const fetchMock = mockPreviewFetch();
    await previewTribeSecretProvision({
      tribeId: "smoke-tribe",
      sourceServiceId: "smoke-api",
      environment: "test",
      secretHashSha256: "a".repeat(64),
      mode: "create-or-rotate",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe("/api/local/tribe-secrets");
    expect(JSON.parse(String(init.body))).toEqual({
      tribeId: "smoke-tribe",
      sourceServiceId: "smoke-api",
      environment: "test",
      secretHashSha256: "a".repeat(64),
      mode: "create-or-rotate",
      preview: true,
    });
    expect(String(init.body)).not.toContain("plaintext");
  });

  it("sends S3 sink remove preview requests", async () => {
    const fetchMock = mockPreviewFetch();
    await previewConfluentS3SinkRemoveTopic({
      topicName: "tribe.smoke-tribe.events",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/local/confluent/s3-sink/remove-topic",
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      topicName: "tribe.smoke-tribe.events",
      preview: true,
    });
  });

  it("sends deployment restart preview requests", async () => {
    const fetchMock = mockPreviewFetch();
    await previewApiCenterDeploymentRestart();

    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/local/deployments/api-center/restart",
    );
    expect(JSON.parse(String(init.body))).toEqual({ preview: true });
  });
});

function mockPreviewFetch() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(previewResponse), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
