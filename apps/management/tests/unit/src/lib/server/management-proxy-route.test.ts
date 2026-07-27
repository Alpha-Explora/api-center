import { describe, expect, it, vi } from "vitest";
import { createManagementProxyGET } from "../../../../../src/lib/server/management-proxy-route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));
const actionMocks = vi.hoisted(() => ({
  requireManagementRouteAction: vi.fn(),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);

describe("createManagementProxyGET", () => {
  it("requires the configured management action and forwards allowlisted query params", async () => {
    actionMocks.requireManagementRouteAction.mockResolvedValue({
      audit: {},
      session: { email: "a@example.com" },
    });
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      Response.json({ success: true }),
    );

    const handler = createManagementProxyGET({
      actionId: "compliance.export.read",
      actionRisk: "read",
      upstreamPath: "/api/v1/admin/compliance/export",
      queryParams: ["from", "to"],
      fallbackError: "Compliance export failed.",
    });

    await handler(
      new Request(
        "http://localhost/api?from=2026-01-01&debug=true&to=2026-01-31",
      ),
    );

    expect(actionMocks.requireManagementRouteAction).toHaveBeenCalledWith({
      request: expect.any(Request),
      actionRisk: "read",
      actionId: "compliance.export.read",
    });
    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/admin/compliance/export?from=2026-01-01&to=2026-01-31",
    );
  });

  it("uses the shared management route error response", async () => {
    actionMocks.requireManagementRouteAction.mockRejectedValue(
      new Error("Management authentication required"),
    );

    const handler = createManagementProxyGET({
      actionId: "compliance.export.read",
      actionRisk: "read",
      upstreamPath: "/api/v1/admin/compliance/export",
      fallbackError: "Compliance export failed.",
    });

    const response = await handler(new Request("http://localhost/api"));

    expect(response.status).toBe(401);
  });

  it("supports dynamic upstream paths with route context", async () => {
    actionMocks.requireManagementRouteAction.mockResolvedValue({
      audit: {},
      session: { email: "a@example.com" },
    });
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      Response.json({ success: true }),
    );

    type Context = {
      params: Promise<{ serviceId: string }>;
    };

    const handler = createManagementProxyGET<Context>({
      upstreamPath: async (_request, context) => {
        const { serviceId } = await context!.params;
        return `/api/v1/admin/registry/services/${encodeURIComponent(serviceId)}`;
      },
      fallbackError: "Service lookup failed.",
    });

    await handler(new Request("http://localhost/api"), {
      params: Promise.resolve({ serviceId: "payment service" }),
    });

    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/admin/registry/services/payment%20service",
    );
  });
});
