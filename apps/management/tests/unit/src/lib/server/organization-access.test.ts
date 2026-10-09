import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeProject, authorizeService } from "../../../../../src/lib/server/organization-access";

const sessionMocks = vi.hoisted(() => ({ requireManagementSession: vi.fn() }));
const adminMocks = vi.hoisted(() => ({ apiCenterAdminJson: vi.fn() }));

vi.mock("@/lib/server/require-management-session", () => sessionMocks);
vi.mock("@/lib/server/api-center-admin", () => adminMocks);

function member(organizationRoles: Record<string, "admin" | "operator" | "observer">) {
  return {
    userId: "member-1",
    email: "member@example.com",
    role: "admin",
    source: "google",
    platformAdmin: false,
    organizationIds: Object.keys(organizationRoles),
    organizationRoles,
  };
}

function projectIn(organizationId: string) {
  adminMocks.apiCenterAdminJson.mockResolvedValue({
    success: true,
    data: { projectId: "project-1", tribe: { tribeId: "tribe-1", organizationId } },
  });
}

const request = new Request("http://localhost/api/local/example");

describe("organization access", () => {
  afterEach(() => vi.clearAllMocks());

  it("rejects a caller without a session before looking up the resource", async () => {
    sessionMocks.requireManagementSession.mockRejectedValue(new Error("Management authentication required"));

    await expect(authorizeProject(request, "project-1")).rejects.toThrow("Management authentication required");
    expect(adminMocks.apiCenterAdminJson).not.toHaveBeenCalled();
  });

  it("lets a platform admin act without an ownership lookup", async () => {
    sessionMocks.requireManagementSession.mockResolvedValue({ ...member({}), platformAdmin: true });

    await expect(authorizeService(request, "payments", "admin")).resolves.toBeUndefined();
    expect(adminMocks.apiCenterAdminJson).not.toHaveBeenCalled();
  });

  it("denies a member of another organization", async () => {
    sessionMocks.requireManagementSession.mockResolvedValue(member({ "org-a": "admin" }));
    projectIn("org-b");

    await expect(authorizeProject(request, "project-1")).rejects.toThrow("Organization access denied");
  });

  it("requires the minimum role in the owning organization", async () => {
    sessionMocks.requireManagementSession.mockResolvedValue(member({ "org-a": "observer" }));
    projectIn("org-a");

    await expect(authorizeProject(request, "project-1")).resolves.toBeUndefined();
    await expect(authorizeProject(request, "project-1", "operator")).rejects.toThrow("Organization access denied");
  });
});
