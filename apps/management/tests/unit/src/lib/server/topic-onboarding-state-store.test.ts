import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTopicOnboardingStateRecord } from "@/lib/service-onboarding";
import {
  getTopicOnboardingStateRecord,
  getOrCreateTopicOnboardingStateRecord,
  updateTopicOnboardingStateRecord,
} from "../../../../../src/lib/server/topic-onboarding-state-store";

let tempDir: string | undefined;

describe("topic onboarding state store", () => {
  afterEach(async () => {
    delete process.env.API_CENTER_BASE_URL;
    delete process.env.API_CENTER_PLATFORM_ADMIN_SECRET;
    delete process.env.TOPIC_ONBOARDING_STATE_PROVIDER;
    vi.unstubAllGlobals();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("persists topic state by owner tribe topic and merges source services", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "topic-state-"));
    const filePath = path.join(tempDir, "states.json");

    const first = await getOrCreateTopicOnboardingStateRecord(
      {
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
        environment: "test",
        physicalTopic: "test.tribe.logistics.events",
      },
      { filePath },
    );
    const next = await updateTopicOnboardingStateRecord(
      "test.tribe.logistics.events",
      {
        serviceId: "logistics-inventory",
        actor: "platform-operator",
        timestamp: "2026-05-20T00:30:00.000Z",
      },
      { filePath },
    );

    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      records: unknown[];
    };

    expect(first.owner_tribe_id).toBe("logistics");
    expect(next.current_state).toBe("Not configured");
    expect(next.source_service_ids).toEqual([
      "logistics-inventory",
      "logistics-orders",
    ]);
    expect(persisted.records).toHaveLength(1);
    expect(persisted.records[0]).toMatchObject({
      owner_tribe_id: "logistics",
      physical_topic: "test.tribe.logistics.events",
      source_service_ids: ["logistics-inventory", "logistics-orders"],
    });
  });

  it("does not advance to sink included without connector running evidence", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "topic-state-"));
    const filePath = path.join(tempDir, "states.json");

    await getOrCreateTopicOnboardingStateRecord(
      {
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
        environment: "test",
        physicalTopic: "test.tribe.logistics.events",
        evidenceLink:
          "confluent://lkc-test/topics/test.tribe.logistics.events",
        stateInputs: {
          classificationApproved: true,
          hasScope: true,
          topicExists: true,
        },
      },
      { filePath },
    );

    const next = await updateTopicOnboardingStateRecord(
      "test.tribe.logistics.events",
      {
        serviceId: "logistics-orders",
        actor: "platform-operator",
        timestamp: "2026-05-20T00:30:00.000Z",
        evidenceLink: "confluent://s3-sink/api-center-test-s3-sink",
        stateInputs: {
          classificationApproved: true,
          hasScope: true,
          topicExists: true,
          s3SinkIncludesTopic: true,
        },
      },
      { filePath },
    );

    expect(next.current_state).toBe("Topic provisioned");
    expect(next.transition_history).toHaveLength(1);
  });

  it("advances to sink included when connector running evidence is present", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "topic-state-"));
    const filePath = path.join(tempDir, "states.json");

    await getOrCreateTopicOnboardingStateRecord(
      {
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
        environment: "test",
        physicalTopic: "test.tribe.logistics.events",
        evidenceLink:
          "confluent://lkc-test/topics/test.tribe.logistics.events",
        stateInputs: {
          classificationApproved: true,
          hasScope: true,
          topicExists: true,
        },
      },
      { filePath },
    );

    const next = await updateTopicOnboardingStateRecord(
      "test.tribe.logistics.events",
      {
        serviceId: "logistics-orders",
        actor: "platform-operator",
        timestamp: "2026-05-20T00:30:00.000Z",
        evidenceLink: "confluent://s3-sink/api-center-test-s3-sink",
        s3SinkConnectorRunningAt: "2026-05-20T00:30:00.000Z",
        stateInputs: {
          classificationApproved: true,
          hasScope: true,
          topicExists: true,
          s3SinkIncludesTopic: true,
        },
      },
      { filePath },
    );

    expect(next.current_state).toBe("Sink included");
    expect(next.transition_history).toContainEqual(
      expect.objectContaining({
        previous_state: "Topic provisioned",
        new_state: "Sink included",
      }),
    );
  });

  it("stores api-center provider records through API Center", async () => {
    process.env.TOPIC_ONBOARDING_STATE_PROVIDER = "api-center";
    process.env.API_CENTER_BASE_URL = "https://api-center.test";
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET = "platform-secret";

    const apiRecord = createTopicOnboardingStateRecord({
      environment: "test",
      ownerTribeId: "logistics",
      physicalTopic: "test.tribe.logistics.events",
      serviceId: "logistics-orders",
      timestamp: "2026-05-20T00:30:00.000Z",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: "missing" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: apiRecord }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getOrCreateTopicOnboardingStateRecord({
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
        environment: "test",
        physicalTopic: "test.tribe.logistics.events",
      }),
    ).resolves.toMatchObject({
      owner_tribe_id: "logistics",
      physical_topic: "test.tribe.logistics.events",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api-center.test/api/v1/data-pipeline/topic-onboarding-states/test.tribe.logistics.events",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-platform-secret": "platform-secret",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api-center.test/api/v1/data-pipeline/topic-onboarding-states/test.tribe.logistics.events",
      expect.objectContaining({
        method: "PUT",
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      record: {
        environment: "test",
        owner_tribe_id: "logistics",
        physical_topic: "test.tribe.logistics.events",
      },
    });
  });

  it("defaults to the api-center provider when a platform admin secret is configured", async () => {
    process.env.API_CENTER_BASE_URL = "https://api-center.test";
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET = "platform-secret";
    const apiRecord = createTopicOnboardingStateRecord({
      environment: "test",
      ownerTribeId: "logistics",
      physicalTopic: "test.tribe.logistics.events",
      serviceId: "logistics-orders",
      timestamp: "2026-05-20T00:30:00.000Z",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: apiRecord }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getTopicOnboardingStateRecord("test.tribe.logistics.events"),
    ).resolves.toMatchObject({
      owner_tribe_id: "logistics",
      physical_topic: "test.tribe.logistics.events",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-center.test/api/v1/data-pipeline/topic-onboarding-states/test.tribe.logistics.events",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-platform-secret": "platform-secret",
        }),
      }),
    );
  });

  it("does not resolve the default local state path from process.cwd", async () => {
    delete process.env.TOPIC_ONBOARDING_STATE_FILE;
    const cwdSpy = vi.spyOn(process, "cwd").mockImplementation(() => {
      throw new Error("process.cwd should not be called for default state path");
    });

    try {
      await getTopicOnboardingStateRecord("test.tribe.logistics.events");
      expect(cwdSpy).not.toHaveBeenCalled();
    } finally {
      cwdSpy.mockRestore();
    }
  });
});
