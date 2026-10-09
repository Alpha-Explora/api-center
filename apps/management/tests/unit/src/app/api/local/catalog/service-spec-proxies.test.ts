import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getCatalog } from "@/app/api/local/catalog/service-specs/route";
import { GET as getVersions } from "@/app/api/local/catalog/services/[serviceId]/spec-versions/route";
import { GET as getVersion } from "@/app/api/local/catalog/services/[serviceId]/spec-versions/[version]/route";

const sessionMocks = vi.hoisted(() => ({
  requireManagementSession: vi.fn(),
}));
const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));

vi.mock("@/lib/server/require-management-session", () => sessionMocks);
vi.mock("@/lib/server/api-center-admin", () => adminMocks);

const request = () =>
  new Request("http://localhost/api/local/catalog/service-specs", {
    headers: { authorization: "Bearer google-id-token" },
  });

const routeCases = [
  {
    name: "catalog list",
    invoke: (input: Request) => getCatalog(input),
    upstreamPath: "/api/v1/admin/catalog/service-specs",
  },
  {
    name: "spec version list",
    invoke: (input: Request) =>
      getVersions(input, {
        params: Promise.resolve({ serviceId: "billing-api" }),
      }),
    upstreamPath: "/api/v1/admin/catalog/services/billing-api/spec-versions",
  },
  {
    name: "spec version detail",
    invoke: (input: Request) =>
      getVersion(input, {
        params: Promise.resolve({ serviceId: "billing-api", version: "1.0.0" }),
      }),
    upstreamPath:
      "/api/v1/admin/catalog/services/billing-api/spec-versions/1.0.0",
  },
];

describe("platform-admin service specification proxies", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(routeCases)(
    "denies a non-platform-admin Google user on $name",
    async ({ invoke }) => {
      sessionMocks.requireManagementSession.mockResolvedValue({
        userId: "member-1",
        email: "member@example.com",
        role: "admin",
        platformAdmin: false,
        source: "google",
      });

      const response = await invoke(request());

      expect(response.status).toBe(403);
      expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
    },
  );

  it.each(routeCases)(
    "allows a platform admin on $name",
    async ({ invoke, upstreamPath }) => {
      sessionMocks.requireManagementSession.mockResolvedValue({
        userId: "admin-1",
        email: "admin@example.com",
        role: "admin",
        platformAdmin: true,
        source: "google",
      });
      adminMocks.apiCenterAdminRequest.mockResolvedValue(
        Response.json({ success: true, data: {} }),
      );

      const response = await invoke(request());

      expect(response.status).toBe(200);
      expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
        upstreamPath,
      );
    },
  );
});
