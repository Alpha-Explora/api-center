import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../../../../../../src/app/api/local/developer-portal/[tribeId]/route";

const clientMocks = vi.hoisted(() => ({
  listQuotaPolicies: vi.fn(),
  listServices: vi.fn(),
}));
const actionMocks = vi.hoisted(() => ({
  requireManagementRouteAction: vi.fn().mockResolvedValue({ audit: {} }),
}));

vi.mock("@/lib/api-center-client", () => clientMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);

describe("GET /api/local/developer-portal/[tribeId]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires a management session before returning a tribe packet", async () => {
    actionMocks.requireManagementRouteAction.mockRejectedValueOnce(
      new Error("Management authentication required"),
    );

    const response = await GET(
      new Request("http://localhost/api/local/developer-portal/campus-one"),
      { params: Promise.resolve({ tribeId: "campus-one" }) },
    );

    expect(response.status).toBe(401);
    expect(clientMocks.listServices).not.toHaveBeenCalled();
    expect(clientMocks.listQuotaPolicies).not.toHaveBeenCalled();
  });

  it("returns the requested tribe packet after read authorization", async () => {
    clientMocks.listServices.mockResolvedValue([
      {
        serviceId: "campus-one",
        serviceType: "tribe",
        ownerTribeId: "campus-one",
        consumes: ["payment"],
      },
      { serviceId: "payment", serviceType: "shared" },
      { serviceId: "logistics", serviceType: "tribe" },
    ]);
    clientMocks.listQuotaPolicies.mockResolvedValue([
      { ownerTribeId: "campus-one", maxRequests: 5000 },
    ]);

    const response = await GET(
      new Request("http://localhost/api/local/developer-portal/campus-one"),
      { params: Promise.resolve({ tribeId: "campus-one" }) },
    );

    const body = await response.json();

    expect(body.data.tribeId).toBe("campus-one");
    expect(body.data.services.map((service: { serviceId: string }) => service.serviceId)).toEqual([
      "campus-one",
      "payment",
    ]);
    expect(actionMocks.requireManagementRouteAction).toHaveBeenCalledWith({
      request: expect.any(Request),
      actionRisk: "read",
      actionId: "developer-portal.packet.read",
    });
  });
});
