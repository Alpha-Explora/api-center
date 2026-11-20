import { afterEach, describe, expect, it, vi } from "vitest";
import { requirePlatformAdministrator } from "../../../../../src/lib/server/organization-access";

const sessionMocks = vi.hoisted(() => ({ authenticateConsoleRequest: vi.fn() }));
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
    sessionMocks.authenticateConsoleRequest.mockResolvedValue({ session: session(true), gatewayHeaders: {} });
    await expect(requirePlatformAdministrator(request)).resolves.toMatchObject({ platformAdmin: true });
    expect(sessionMocks.authenticateConsoleRequest).toHaveBeenCalledWith(request);
  });

  it("refuses an organization admin who is not a platform operator", async () => {
    sessionMocks.authenticateConsoleRequest.mockResolvedValue({ session: session(false), gatewayHeaders: {} });
    await expect(requirePlatformAdministrator(request)).rejects.toThrow("Platform administrator required");
  });

  it("refuses a caller without a session", async () => {
    sessionMocks.authenticateConsoleRequest.mockRejectedValue(new Error("Management authentication required"));
    await expect(requirePlatformAdministrator(request)).rejects.toThrow("Management authentication required");
  });
});
