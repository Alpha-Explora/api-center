import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../../../../../src/app/api/local/tribe-secrets/route";

const sessionMocks = vi.hoisted(() => ({
  requireManagementSession: vi.fn().mockResolvedValue({
    userId: "admin-1",
    email: "admin@example.com",
    role: "admin",
    source: "google",
  }),
}));
const actionMocks = vi.hoisted(() => ({
  requireManagementAction: vi.fn().mockResolvedValue({ audit: {} }),
}));
const secretMocks = vi.hoisted(() => ({
  getProjectId: vi.fn(() => "api-center-test"),
  getSecretManagerAuthReadiness: vi.fn(() => ({ ok: true })),
  shouldUseLocalGcloudImpersonation: vi.fn(() => true),
  provisionSecretWithLocalGcloudImpersonation: vi.fn(async () => ({
    versionName:
      "projects/api-center-test/secrets/api-center-tribe-secret-church-donations-live/versions/7",
  })),
  createSecretManagerClient: vi.fn(),
}));

vi.mock("@/lib/server/require-management-session", () => sessionMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);
vi.mock("@/lib/server/gcp-secret-manager", () => secretMocks);

describe("POST /api/local/tribe-secrets", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires tribeId, sourceServiceId, and environment", async () => {
    const response = await POST(
      new Request("http://localhost/api/local/tribe-secrets", {
        method: "POST",
        body: JSON.stringify({
          serviceId: "church-donations",
          secretHashSha256: "a".repeat(64),
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(secretMocks.provisionSecretWithLocalGcloudImpersonation).not.toHaveBeenCalled();
  });

  it("authorizes against the requested live environment and stores an environment-scoped tribe secret", async () => {
    const response = await POST(
      new Request("http://localhost/api/local/tribe-secrets", {
        method: "POST",
        body: JSON.stringify({
          tribeId: "church-donations",
          sourceServiceId: "spark-site",
          environment: "live",
          secretHashSha256: "b".repeat(64),
          confirmation: {
            typedPhrase: "APPLY LIVE CHANGE",
            reason: "Approved live service handoff",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(actionMocks.requireManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "live",
        actionRisk: "provider-write",
        actionId: "tribe-secret.provision",
      }),
    );
    expect(secretMocks.provisionSecretWithLocalGcloudImpersonation).toHaveBeenCalledWith(
      expect.objectContaining({
        secretId: "api-center-tribe-secret-church-donations-live",
        secretName:
          "projects/api-center-test/secrets/api-center-tribe-secret-church-donations-live",
      }),
    );
    const provisionCalls = (secretMocks.provisionSecretWithLocalGcloudImpersonation as ReturnType<typeof vi.fn>).mock.calls;
    const provisionInput = provisionCalls[0]?.[0] as { payload: string } | undefined;
    expect(provisionInput).toBeDefined();
    const payload = JSON.parse(provisionInput!.payload);
    expect(payload).toMatchObject({
      tribeId: "church-donations",
      sourceServiceId: "spark-site",
      provisionedForServiceIds: ["spark-site"],
      environment: "live",
      secretHashSha256: "b".repeat(64),
    });
    expect(body.data).toMatchObject({
      serviceId: "spark-site",
      tribeId: "church-donations",
      sourceServiceId: "spark-site",
      environment: "live",
      secretId: "api-center-tribe-secret-church-donations-live",
      versionNumber: "7",
    });
  });
});
