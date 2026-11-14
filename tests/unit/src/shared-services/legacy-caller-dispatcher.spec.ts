import type { Response } from "express";
import { LegacyCallerDispatcher } from "../../../../apps/gateway/src/domains/gateway-proxy/legacy-bridge/legacy-caller-dispatcher";
import type { LegacyBridgeService } from "../../../../apps/gateway/src/domains/control-plane/migration/legacy-bridge.service";
import type { AuthenticatedRequest } from "../../../../apps/gateway/src/types";

const target = { kind: "capability" as const, capability: "email", method: "POST", relativePath: "/send" };
const migrated = { organizationId: "org", projectId: "prj_x", environmentKind: "test" as const, sourceServiceId: "shop-api", applicationId: "app_x" };

function setup(route: Record<string, unknown>) {
  const bridge = {
    route: jest.fn().mockResolvedValue(route),
    shadow: jest.fn().mockResolvedValue(undefined),
    authorize: jest.fn().mockResolvedValue({ signedContext: "ctx", identity: {}, requestKey: "k" }),
    recordOutcome: jest.fn().mockResolvedValue(undefined),
  };
  const fetchImpl = jest.fn().mockResolvedValue(new Response("{}", { status: 202 }));
  const dispatcher = new LegacyCallerDispatcher(bridge as unknown as LegacyBridgeService, { fetchImpl, cloudRunAuthorizer: async () => undefined });
  const req = {
    method: "POST",
    path: "/api/v1/shared/email/send",
    originalUrl: "/api/v1/shared/email/send",
    headers: { authorization: "Bearer legacy.jwt" },
    body: { to: "a@example.test" },
    sourceServiceId: "shop-api",
    projectId: "shop",
    user: { environment: "test" },
  } as unknown as AuthenticatedRequest;
  const res = { status: jest.fn().mockReturnThis(), setHeader: jest.fn(), send: jest.fn() } as unknown as Response;
  return { bridge, fetchImpl, dispatcher, req, res };
}

describe("LegacyCallerDispatcher", () => {
  it("runs the legacy handler untouched for callers that were never migrated", async () => {
    const { dispatcher, req, res, bridge } = setup({ mode: "legacy" });
    const legacy = jest.fn().mockResolvedValue(undefined);
    await dispatcher.dispatch(req, res, target, legacy);
    expect(legacy).toHaveBeenCalled();
    expect(bridge.shadow).not.toHaveBeenCalled();
  });

  it("shadows the legacy decision for migrated callers before cutover", async () => {
    const { dispatcher, req, res, bridge } = setup({ mode: "shadow", ...migrated });
    await dispatcher.dispatch(req, res, target, jest.fn().mockResolvedValue(undefined));
    expect(bridge.shadow).toHaveBeenCalledWith(expect.objectContaining({ mode: "shadow" }), target, true);

    const denied = Object.assign(new Error("Forbidden"), { status: 403 });
    await expect(dispatcher.dispatch(req, res, target, jest.fn().mockRejectedValue(denied))).rejects.toThrow("Forbidden");
    expect(bridge.shadow).toHaveBeenLastCalledWith(expect.anything(), target, false);

    bridge.shadow.mockClear();
    const throttled = Object.assign(new Error("Too many"), { status: 429 });
    await expect(dispatcher.dispatch(req, res, target, jest.fn().mockRejectedValue(throttled))).rejects.toThrow("Too many");
    expect(bridge.shadow).not.toHaveBeenCalled();
  });

  it("authorizes cut-over callers through the control plane and never runs the legacy handler", async () => {
    process.env.SHARED_SERVICE_ROUTE_EMAIL_TEST = "http://email.internal:4012";
    const { dispatcher, req, res, bridge, fetchImpl } = setup({ mode: "control-plane", ...migrated });
    const legacy = jest.fn();
    await dispatcher.dispatch(req, res, target, legacy);
    expect(legacy).not.toHaveBeenCalled();
    expect(bridge.authorize).toHaveBeenCalledWith(expect.objectContaining({ mode: "control-plane" }), target, expect.objectContaining({ requestId: expect.any(String) }));
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://email.internal:4012/send");
    expect(init.headers["X-APICenter-Context"]).toBe("ctx");
    expect(JSON.stringify(init.headers)).not.toContain("legacy.jwt");
    expect(bridge.recordOutcome).toHaveBeenCalledWith(expect.anything(), 202);
  });
});
