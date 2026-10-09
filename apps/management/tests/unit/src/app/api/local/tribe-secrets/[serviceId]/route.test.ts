import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DELETE,
  GET,
} from "../../../../../../../../src/app/api/local/tribe-secrets/[serviceId]/route";

const sessionMocks = vi.hoisted(() => ({
  requireManagementSession: vi.fn().mockResolvedValue({
    userId: "operator-1",
    email: "operator@example.com",
    role: "operator",
    source: "google",
  }),
}));
const actionMocks = vi.hoisted(() => ({
  requireManagementAction: vi.fn().mockResolvedValue({ audit: {} }),
}));
const accessMocks = vi.hoisted(() => ({
  authorizeService: vi.fn().mockResolvedValue("org-1"),
}));
const secretMocks = vi.hoisted(() => ({
  getProjectId: vi.fn(() => "api-center-test"),
  getSecretManagerAuthReadiness: vi.fn(() => ({ ok: true })),
  getTribeSecretStatus: vi.fn(),
  deleteTribeSecret: vi.fn(),
}));

vi.mock("@/lib/server/require-management-session", () => sessionMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);
vi.mock("@/lib/server/organization-access", () => accessMocks);
vi.mock("@/lib/server/gcp-secret-manager", () => secretMocks);

describe("/api/local/tribe-secrets/[serviceId]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires a management session before reading Secret Manager status", async () => {
    accessMocks.authorizeService.mockRejectedValueOnce(
      new Error("Management authentication required"),
    );

    const response = await GET(
      new Request("http://localhost/api/local/tribe-secrets/campus-one"),
      { params: Promise.resolve({ serviceId: "campus-one" }) },
    );

    expect(response.status).toBe(401);
    expect(secretMocks.getTribeSecretStatus).not.toHaveBeenCalled();
  });

  it("returns environment-scoped status metadata after authentication", async () => {
    secretMocks.getTribeSecretStatus.mockResolvedValue({
      serviceId: "campus-one",
      secretId: "api-center-service-secret-campus-one-live",
      expectedSecretId: "api-center-service-secret-campus-one-live",
      exists: true,
      enabled: true,
      state: "ENABLED",
      latestEnabledVersion: "2",
      latestVersionCreatedAt: "2026-01-01T00:00:00.000Z",
    });

    const response = await GET(
      new Request(
        "http://localhost/api/local/tribe-secrets/campus-one?environment=live",
      ),
      { params: Promise.resolve({ serviceId: "campus-one" }) },
    );

    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      serviceId: "campus-one",
      environment: "live",
      secretId: "api-center-service-secret-campus-one-live",
    });
    expect(secretMocks.getTribeSecretStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: "campus-one",
        environment: "live",
        secretName:
          "projects/api-center-test/secrets/api-center-service-secret-campus-one-live",
      }),
    );
  });

  it("does not read secret status for a service in another organization", async () => {
    accessMocks.authorizeService.mockRejectedValueOnce(
      new Error("Organization access denied"),
    );

    const response = await GET(
      new Request("http://localhost/api/local/tribe-secrets/other-org-service"),
      { params: Promise.resolve({ serviceId: "other-org-service" }) },
    );

    expect(response.status).toBe(403);
    expect(secretMocks.getTribeSecretStatus).not.toHaveBeenCalled();
  });

  it("authorizes live delete against the target environment", async () => {
    secretMocks.deleteTribeSecret.mockResolvedValue({
      serviceId: "campus-one",
      secretId: "api-center-service-secret-campus-one-live",
      action: "deleted",
    });

    const response = await DELETE(
      new Request("http://localhost/api/local/tribe-secrets/campus-one", {
        method: "DELETE",
        headers: { authorization: "Bearer test-session" },
        body: JSON.stringify({
          mode: "delete",
          environment: "live",
          confirmServiceId: "campus-one",
          confirmation: {
            typedPhrase: "APPLY LIVE CHANGE",
            reason: "Approved emergency rotation cleanup",
          },
        }),
      }),
      { params: Promise.resolve({ serviceId: "campus-one" }) },
    );

    expect(response.status).toBe(200);
    expect(actionMocks.requireManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "live",
        actionRisk: "destructive",
        actionId: "tribe-secret.delete",
      }),
    );
    expect(secretMocks.deleteTribeSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        secretId: "api-center-service-secret-campus-one-live",
      }),
    );
  });

  it("does not delete a secret when the service belongs to another organization", async () => {
    accessMocks.authorizeService.mockRejectedValueOnce(
      new Error("Organization access denied"),
    );

    const response = await DELETE(
      new Request(
        "http://localhost/api/local/tribe-secrets/other-org-service",
        {
          method: "DELETE",
          body: JSON.stringify({
            mode: "delete",
            environment: "test",
            confirmServiceId: "other-org-service",
          }),
        },
      ),
      { params: Promise.resolve({ serviceId: "other-org-service" }) },
    );

    expect(response.status).toBe(403);
    expect(secretMocks.deleteTribeSecret).not.toHaveBeenCalled();
  });
});
