import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as goLive } from "@/app/api/local/services/[serviceId]/go-live/route";
import { GET as requests } from "@/app/api/local/services/[serviceId]/requests/route";
import {
  GET as events,
  POST as replay,
} from "@/app/api/local/services/[serviceId]/events/route";
import { POST as rotation } from "@/app/api/local/services/[serviceId]/credential-rotation/route";
import { POST as verify } from "@/app/api/local/services/[serviceId]/verification/route";
import { POST as revoke } from "@/app/api/local/payment-consumers/[serviceId]/revoke-key/route";
import { GET as unattributed } from "@/app/api/local/request-diagnostics/route";

const session = vi.hoisted(() => ({ requireManagementSession: vi.fn() }));
const gateway = vi.hoisted(() => ({
  apiCenterAdminJson: vi.fn(),
  apiCenterAdminRequest: vi.fn(),
}));
vi.mock("@/lib/server/require-management-session", () => session);
vi.mock("@/lib/server/api-center-admin", () => gateway);
const context = { params: Promise.resolve({ serviceId: "consumer-a" }) };
const member = (role: "admin" | "operator" | "observer" = "admin") => ({
  userId: "user-a",
  email: "operator@example.test",
  source: "google",
  role,
  platformAdmin: false,
  organizationIds: ["org-a"],
  organizationRoles: { "org-a": role },
});
const mutation = (body: object) =>
  new Request("http://localhost/api/local/example", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const operationId = "00000000-0000-4000-8000-000000000001";

describe("operability route authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    session.requireManagementSession.mockResolvedValue(member());
    gateway.apiCenterAdminJson.mockImplementation(async (path: string) => ({
      success: true,
      data: path.includes("/tenancy/")
        ? { organizationId: "org-b" }
        : { ownerTribeId: "tribe-b" },
    }));
    gateway.apiCenterAdminRequest.mockResolvedValue(
      Response.json({ success: true, data: [] }),
    );
  });

  it.each([goLive, requests, events])(
    "denies another organization's reads",
    async (handler) => {
      expect(
        (
          await handler(
            new Request("http://localhost/?environment=live"),
            context,
          )
        ).status,
      ).toBe(403);
      expect(gateway.apiCenterAdminRequest).not.toHaveBeenCalled();
    },
  );

  it.each([replay, rotation, verify, revoke])(
    "denies another organization's mutations before an external effect",
    async (handler) => {
      const response = await handler(
        mutation({
          environment: "live",
          operationId,
          eventId: operationId,
          keyId: operationId,
          reason: "Fixture operation",
          action: "verify",
          confirmation: {
            typedPhrase: "APPLY LIVE CHANGE",
            reason: "Fixture operation",
          },
        }),
        context,
      );
      expect(response.status).toBe(403);
      expect(gateway.apiCenterAdminRequest).not.toHaveBeenCalled();
    },
  );

  it("requires a platform administrator for unattributed failures", async () => {
    expect(
      (
        await unattributed(
          new Request("http://localhost/?correlationId=fixture"),
        )
      ).status,
    ).toBe(403);
    expect(gateway.apiCenterAdminRequest).not.toHaveBeenCalled();
  });

  it("uses the path service and session actor, rejects missing live confirmation", async () => {
    session.requireManagementSession.mockResolvedValue({
      ...member(),
      platformAdmin: true,
    });
    const input = {
      environment: "live",
      operationId,
      eventId: operationId,
      reason: "Fixture operation",
      actor: "forged",
      serviceId: "forged",
    };
    expect((await replay(mutation(input), context)).status).toBe(400);
    expect(gateway.apiCenterAdminRequest).not.toHaveBeenCalled();
    expect(
      (
        await replay(
          mutation({
            ...input,
            confirmation: {
              reason: input.reason,
              typedPhrase: "APPLY LIVE CHANGE",
            },
          }),
          context,
        )
      ).status,
    ).toBe(200);
    const [path, options] = gateway.apiCenterAdminRequest.mock.calls[0];
    expect(path).toBe("/api/v1/admin/payments/events/consumer-a/replay");
    expect(JSON.parse(options.body)).toMatchObject({
      actor: "operator@example.test",
      operationId,
      environment: "live",
    });
    expect(JSON.parse(options.body)).not.toHaveProperty("serviceId");
  });
});
