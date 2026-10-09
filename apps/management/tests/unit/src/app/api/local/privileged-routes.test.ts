import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getAlerts } from "../../../../../../src/app/api/local/analytics/alerts/route";
import { GET as getConfluentStatus } from "../../../../../../src/app/api/local/confluent/status/[serviceId]/route";
import { POST as provisionTopic } from "../../../../../../src/app/api/local/confluent/topics/provision/route";
import { POST as migrateTopic } from "../../../../../../src/app/api/local/confluent/topic-migrations/route";
import { POST as includeSinkTopic } from "../../../../../../src/app/api/local/confluent/s3-sink/include-topic/route";
import { POST as removeSinkTopic } from "../../../../../../src/app/api/local/confluent/s3-sink/remove-topic/route";
import { GET as getOnboardingState } from "../../../../../../src/app/api/local/topic-onboarding-states/[topicName]/route";
import { POST as issueServiceToken } from "../../../../../../src/app/api/local/auth/token/route";

const accessMocks = vi.hoisted(() => ({
  platformAdministratorResponse: vi.fn(
    () => new Response(JSON.stringify({ success: false }), { status: 403 }),
  ),
}));

vi.mock("@/lib/server/organization-access", () => accessMocks);

describe("platform-admin-only management routes", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_LOCAL_MANAGEMENT_MODE;
  });

  it.each([
    [
      "analytics alerts",
      () =>
        getAlerts(new Request("http://localhost/api/local/analytics/alerts")),
    ],
    [
      "Confluent status",
      () =>
        getConfluentStatus(
          new Request("http://localhost/api/local/confluent/status/svc"),
          { params: Promise.resolve({ serviceId: "svc" }) },
        ),
    ],
    [
      "topic onboarding state",
      () =>
        getOnboardingState(
          new Request(
            "http://localhost/api/local/topic-onboarding-states/topic?serviceId=svc",
          ),
          { params: Promise.resolve({ topicName: "topic" }) },
        ),
    ],
    [
      "service token issuance",
      () =>
        issueServiceToken(
          new Request("http://localhost/api/local/auth/token", {
            method: "POST",
            body: "{}",
          }),
        ),
    ],
    [
      "topic provision",
      () =>
        provisionTopic(
          new Request("http://localhost/api/local/confluent/topics/provision", {
            method: "POST",
            body: "{}",
          }),
        ),
    ],
    [
      "topic migration",
      () =>
        migrateTopic(
          new Request("http://localhost/api/local/confluent/topic-migrations", {
            method: "POST",
            body: "{}",
          }),
        ),
    ],
    [
      "S3 sink include",
      () =>
        includeSinkTopic(
          new Request(
            "http://localhost/api/local/confluent/s3-sink/include-topic",
            { method: "POST", body: "{}" },
          ),
        ),
    ],
    [
      "S3 sink remove",
      () =>
        removeSinkTopic(
          new Request(
            "http://localhost/api/local/confluent/s3-sink/remove-topic",
            { method: "POST", body: "{}" },
          ),
        ),
    ],
  ])("blocks non-platform users from %s before work", async (_name, invoke) => {
    process.env.NEXT_PUBLIC_LOCAL_MANAGEMENT_MODE = "true";
    const response = await invoke();

    expect(response.status).toBe(403);
    expect(accessMocks.platformAdministratorResponse).toHaveBeenCalledOnce();
  });
});
