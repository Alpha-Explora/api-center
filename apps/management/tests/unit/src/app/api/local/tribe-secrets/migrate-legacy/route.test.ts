import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../../../../../../src/app/api/local/tribe-secrets/migrate-legacy/route";

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
  accessLatestSecretPayload: vi.fn(),
  provisionSecretWithLocalGcloudImpersonation: vi.fn(async () => ({
    versionName:
      "projects/api-center-test/secrets/api-center-tribe-secret-church-donations-test/versions/2",
  })),
  createSecretManagerClient: vi.fn(),
}));

vi.mock("@/lib/server/require-management-session", () => sessionMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);
vi.mock("@/lib/server/gcp-secret-manager", () => secretMocks);

describe("POST /api/local/tribe-secrets/migrate-legacy", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("copies the legacy hash into the scoped test secret without exposing the hash", async () => {
    secretMocks.accessLatestSecretPayload.mockResolvedValueOnce(
      JSON.stringify({
        serviceId: "church-donations",
        secretHashSha256: "A".repeat(64),
        status: "active",
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/local/tribe-secrets/migrate-legacy", {
        method: "POST",
        body: JSON.stringify({
          tribeId: "church-donations",
          sourceServiceId: "church-donations",
          environment: "test",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(actionMocks.requireManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "test",
        actionRisk: "state-write",
        actionId: "tribe-secret.migrate-legacy-test",
      }),
    );
    expect(secretMocks.accessLatestSecretPayload).toHaveBeenCalledWith(
      "projects/api-center-test/secrets/api-center-tribe-secret-church-donations",
    );
    const provisionInput = (secretMocks.provisionSecretWithLocalGcloudImpersonation.mock.calls as unknown as Array<[
      { payload: string; secretId: string },
    ]>)[0]?.[0];
    expect(provisionInput?.secretId).toBe(
      "api-center-tribe-secret-church-donations-test",
    );
    expect(JSON.parse(provisionInput!.payload)).toMatchObject({
      tribeId: "church-donations",
      sourceServiceId: "church-donations",
      environment: "test",
      secretHashSha256: "a".repeat(64),
    });
    expect(JSON.stringify(body)).not.toContain("a".repeat(64));
    expect(body.data).toMatchObject({
      serviceId: "church-donations",
      tribeId: "church-donations",
      sourceServiceId: "church-donations",
      environment: "test",
      legacySecretId: "api-center-tribe-secret-church-donations",
      secretId: "api-center-tribe-secret-church-donations-test",
      versionNumber: "2",
    });
  });

  it("falls back to the old test-prefixed legacy secret name", async () => {
    secretMocks.accessLatestSecretPayload
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("b".repeat(64));

    const response = await POST(
      new Request("http://localhost/api/local/tribe-secrets/migrate-legacy", {
        method: "POST",
        body: JSON.stringify({
          tribeId: "church-donations",
          sourceServiceId: "church-donations",
          environment: "test",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(secretMocks.accessLatestSecretPayload).toHaveBeenNthCalledWith(
      1,
      "projects/api-center-test/secrets/api-center-tribe-secret-church-donations",
    );
    expect(secretMocks.accessLatestSecretPayload).toHaveBeenNthCalledWith(
      2,
      "projects/api-center-test/secrets/api-center-test-tribe-secret-church-donations",
    );
    expect(body.data).toMatchObject({
      legacySecretId: "api-center-test-tribe-secret-church-donations",
      secretId: "api-center-tribe-secret-church-donations-test",
    });
  });

  it("rejects attempts to migrate the legacy secret into live", async () => {
    const response = await POST(
      new Request("http://localhost/api/local/tribe-secrets/migrate-legacy", {
        method: "POST",
        body: JSON.stringify({
          tribeId: "church-donations",
          sourceServiceId: "church-donations",
          environment: "live",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(secretMocks.accessLatestSecretPayload).not.toHaveBeenCalled();
    expect(secretMocks.provisionSecretWithLocalGcloudImpersonation).not.toHaveBeenCalled();
  });
});