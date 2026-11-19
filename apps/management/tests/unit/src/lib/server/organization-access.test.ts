import { afterEach, describe, expect, it, vi } from "vitest";
import { requirePlatformAdministrator } from "../../../../../src/lib/server/organization-access";

const sessionMocks = vi.hoisted(() => ({ requireManagementSession: vi.fn() }));
vi.mock("@/lib/server/require-management-session", () => sessionMocks);

const session = (platformAdmin: boolean) => ({
  userId: "member-1",
  email: "member@example.com",
  role: "admin",
  source: "google",
  platformAdmin,
  organizationIds: ["org-1"],
  organizationRoles: { "org-1": "admin" },
});
const request = new Request("http://localhost/api/local/request-diagnostics", { headers: { authorization: "Bearer id-token" } });

describe("requirePlatformAdministrator", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns the session of a platform operator", async () => {
    sessionMocks.requireManagementSession.mockResolvedValue(session(true));
    await expect(requirePlatformAdministrator(request)).resolves.toMatchObject({ platformAdmin: true });
    expect(sessionMocks.requireManagementSession).toHaveBeenCalledWith({ authorizationHeader: "Bearer id-token" });
  });

  it("refuses an organization admin who is not a platform operator", async () => {
    sessionMocks.requireManagementSession.mockResolvedValue(session(false));
    await expect(requirePlatformAdministrator(request)).rejects.toThrow("Platform administrator required");
  });

  it("refuses a caller without a session", async () => {
    sessionMocks.requireManagementSession.mockRejectedValue(new Error("Management authentication required"));
    await expect(requirePlatformAdministrator(request)).rejects.toThrow("Management authentication required");
  });
});
