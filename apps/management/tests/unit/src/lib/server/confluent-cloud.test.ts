import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConfluentCloudError,
  createConfluentCloudClient,
} from "../../../../../src/lib/server/confluent-cloud";

describe("createConfluentCloudClient", () => {
  beforeEach(() => {
    process.env.CONFLUENT_ENVIRONMENT_ID = "env-123";
    process.env.CONFLUENT_KAFKA_CLUSTER_ID = "lkc-123";
    process.env.CONFLUENT_KAFKA_REST_ENDPOINT = "https://kafka.example.com";
    process.env.CONFLUENT_KAFKA_API_KEY = "kafka-key";
    process.env.CONFLUENT_KAFKA_API_SECRET = "kafka-secret";
    process.env.CONFLUENT_CLOUD_API_KEY = "cloud-key";
    process.env.CONFLUENT_CLOUD_API_SECRET = "cloud-secret";
    process.env.CONFLUENT_S3_CONNECTOR_NAME = "api-center-s3-sink";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CONFLUENT_ENVIRONMENT_ID;
    delete process.env.CONFLUENT_KAFKA_CLUSTER_ID;
    delete process.env.CONFLUENT_KAFKA_REST_ENDPOINT;
    delete process.env.CONFLUENT_KAFKA_API_KEY;
    delete process.env.CONFLUENT_KAFKA_API_SECRET;
    delete process.env.CONFLUENT_CLOUD_API_KEY;
    delete process.env.CONFLUENT_CLOUD_API_SECRET;
    delete process.env.CONFLUENT_S3_CONNECTOR_NAME;
    delete process.env.CONFLUENT_DEFAULT_RETENTION_MS;
  });

  it("treats an already-included S3 sink topic as a no-op", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        config: {
          topics: "prod.tribe.beta.events,prod.tribe.alpha.events",
        },
      }),
    );
    const client = createConfluentCloudClient(fetchMock as unknown as typeof fetch);

    await expect(
      client.includeTopicInS3Sink("prod.tribe.beta.events"),
    ).resolves.toMatchObject({
      updated: false,
      alreadyIncluded: true,
      topics: ["prod.tribe.alpha.events", "prod.tribe.beta.events"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("verifies an S3 sink topic update before reporting success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          config: {
            topics: "prod.tribe.alpha.events",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({
          config: {
            topics: "prod.tribe.beta.events,prod.tribe.alpha.events",
          },
        }),
      );
    const client = createConfluentCloudClient(fetchMock as unknown as typeof fetch);

    await expect(
      client.includeTopicInS3Sink("prod.tribe.beta.events"),
    ).resolves.toMatchObject({
      updated: true,
      alreadyIncluded: false,
      topics: ["prod.tribe.alpha.events", "prod.tribe.beta.events"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not report success when the S3 sink update fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ config: { topics: "" } }))
      .mockResolvedValueOnce(new Response("permission denied", { status: 403 }));
    const client = createConfluentCloudClient(fetchMock as unknown as typeof fetch);

    await expect(
      client.includeTopicInS3Sink("prod.tribe.beta.events"),
    ).rejects.toBeInstanceOf(ConfluentCloudError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not report success when Confluent accepts but does not persist the topic", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ config: { topics: "" } }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ config: { topics: "" } }));
    const client = createConfluentCloudClient(fetchMock as unknown as typeof fetch);

    await expect(
      client.includeTopicInS3Sink("prod.tribe.beta.events"),
    ).rejects.toThrow("did not persist the requested topic");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
