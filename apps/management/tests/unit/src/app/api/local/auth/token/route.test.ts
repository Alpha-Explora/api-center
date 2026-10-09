import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeService: vi.fn(),
  requireManagementRouteAction: vi.fn(),
  apiCenterAdminRequest: vi.fn(),
}));

vi.mock("@/lib/server/organization-access", () => ({
  authorizeService: mocks.authorizeService,
}));
vi.mock("@/lib/server/require-management-action", () => ({
  requireManagementRouteAction: mocks.requireManagementRouteAction,
}));
vi.mock("@/lib/server/api-center-admin", () => ({
  apiCenterAdminRequest: mocks.apiCenterAdminRequest,
}));

import { POST } from "../../../../../../../../src/app/api/local/auth/token/route";

function tokenRequest(serviceId = "service-a") {
  return new Request("https://console.test/api/local/auth/token", {
    method: "POST",
    headers: { authorization: "Bearer member-token", "content-type": "application/json" },
    body: JSON.stringify({ serviceId, secret: "service-secret", environment: "test" }),
  });
}

describe("POST /api/local/auth/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeService.mockResolvedValue("organization-a");
    mocks.requireManagementRouteAction.mockResolvedValue({ session: {} });
    mocks.apiCenterAdminRequest.mockResolvedValue(
      Response.json({ success: true, data: { accessToken: "issued-token" } }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("allows an operator to issue a token for a service in their organization", async () => {
    const request = tokenRequest();
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.authorizeService).toHaveBeenCalledWith(request, "service-a", "operator");
    expect(mocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/auth/token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("denies an operator whose organization does not own the service", async () => {
    mocks.authorizeService.mockRejectedValueOnce(new Error("Organization access denied"));

    const response = await POST(tokenRequest("service-b"));

    expect(response.status).toBe(403);
    expect(mocks.authorizeService).toHaveBeenCalledWith(
      expect.any(Request),
      "service-b",
      "operator",
    );
    expect(mocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });

  it("preserves platform-admin token issuance", async () => {
    const request = tokenRequest("admin-service");
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.authorizeService).toHaveBeenCalledWith(request, "admin-service", "operator");
    expect(mocks.apiCenterAdminRequest).toHaveBeenCalledOnce();
  });
});
