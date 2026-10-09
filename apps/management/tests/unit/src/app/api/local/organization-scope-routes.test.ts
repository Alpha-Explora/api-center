import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  adminJson: vi.fn(),
  adminRequest: vi.fn(),
}));

vi.mock("@/lib/server/require-management-session", () => ({
  requireManagementSession: mocks.requireSession,
}));
vi.mock("@/lib/server/api-center-admin", () => ({
  apiCenterAdminJson: mocks.adminJson,
  apiCenterAdminRequest: mocks.adminRequest,
}));
vi.mock("@/lib/server/require-management-action", () => ({
  requireManagementRouteAction: vi.fn(async () => ({ session: {} })),
}));

import { GET as listTribes } from "../../../../../../src/app/api/local/tenancy/tribes/route";
import { GET as listServices } from "../../../../../../src/app/api/local/registry/services/route";
import { PATCH as updateTribe } from "../../../../../../src/app/api/local/tenancy/tribes/[tribeId]/route";
import { PATCH as updateProject } from "../../../../../../src/app/api/local/tenancy/projects/[projectId]/route";
import { PATCH as activateService } from "../../../../../../src/app/api/local/registry/services/[serviceId]/activate/route";

const organizationA = "00000000-0000-4000-8000-00000000000a";
const organizationB = "00000000-0000-4000-8000-00000000000b";

function memberSession() {
  return {
    userId: "member-a",
    email: "member-a@example.com",
    role: "admin",
    source: "google",
    platformAdmin: false,
    organizationIds: [organizationA],
    organizationRoles: { [organizationA]: "admin" },
  };
}

describe("organization-scoped console routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue(memberSession());
    mocks.adminRequest.mockResolvedValue(Response.json({ success: true, data: [] }));
  });

  it("sends only the signed-in organization's id to the tribe collection read", async () => {
    const response = await listTribes(new Request("https://console.test/api/local/tenancy/tribes", {
      headers: { authorization: "Bearer member-token" },
    }));

    expect(response.status).toBe(200);
    expect(mocks.adminRequest).toHaveBeenCalledWith(
      `/api/v1/tenancy/tribes?organizationId=${organizationA}`,
    );
  });

  it("sends only the signed-in organization's id to the service collection read", async () => {
    const response = await listServices(new Request("https://console.test/api/local/registry/services", {
      headers: { authorization: "Bearer member-token" },
    }));

    expect(response.status).toBe(200);
    expect(mocks.adminRequest).toHaveBeenCalledWith(
      `/api/v1/registry/services?organizationId=${organizationA}`,
    );
  });

  it("blocks changing another organization's tribe", async () => {
    mocks.adminJson.mockResolvedValue({ success: true, data: { organizationId: organizationB } });
    const response = await updateTribe(
      new Request("https://console.test/api/local/tenancy/tribes/tribe-b", {
        method: "PATCH",
        headers: { authorization: "Bearer member-token", "content-type": "application/json" },
        body: JSON.stringify({ status: "suspended" }),
      }),
      { params: Promise.resolve({ tribeId: "tribe-b" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.adminRequest).not.toHaveBeenCalled();
  });

  it("uses the organization's role instead of the user's highest role elsewhere", async () => {
    mocks.requireSession.mockResolvedValue({
      ...memberSession(),
      role: "admin",
      organizationIds: [organizationA, organizationB],
      organizationRoles: { [organizationA]: "admin", [organizationB]: "observer" },
    });
    mocks.adminJson.mockResolvedValue({ success: true, data: { organizationId: organizationB } });
    const response = await updateTribe(
      new Request("https://console.test/api/local/tenancy/tribes/tribe-b", {
        method: "PATCH",
        headers: { authorization: "Bearer member-token", "content-type": "application/json" },
        body: JSON.stringify({ status: "suspended" }),
      }),
      { params: Promise.resolve({ tribeId: "tribe-b" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.adminRequest).not.toHaveBeenCalled();
  });

  it("blocks changing another organization's project", async () => {
    mocks.adminJson.mockResolvedValue({
      success: true,
      data: { projectId: "project-b", tribe: { organizationId: organizationB } },
    });
    const response = await updateProject(
      new Request("https://console.test/api/local/tenancy/projects/project-b", {
        method: "PATCH",
        headers: { authorization: "Bearer member-token", "content-type": "application/json" },
        body: JSON.stringify({ status: "suspended" }),
      }),
      { params: Promise.resolve({ projectId: "project-b" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.adminRequest).not.toHaveBeenCalled();
  });

  it("blocks changing another organization's service", async () => {
    mocks.adminJson
      .mockResolvedValueOnce({ success: true, data: { ownerTribeId: "tribe-b" } })
      .mockResolvedValueOnce({ success: true, data: { organizationId: organizationB } });
    const response = await activateService(
      new Request("https://console.test/api/local/registry/services/service-b/activate", {
        method: "PATCH",
        headers: { authorization: "Bearer member-token" },
      }),
      { params: Promise.resolve({ serviceId: "service-b" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.adminRequest).not.toHaveBeenCalled();
  });
});
