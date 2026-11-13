import type { Response } from "express";
import {
  ApplicationCapabilityProxy,
  relativeCapabilityPath,
} from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/application-capability-proxy";
import { SharedServiceRoutingService } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/shared-service-routing.service";
import type { ApplicationAccessService } from "../../../../apps/gateway/src/domains/control-plane/application-access.service";
import type { AuthenticatedRequest } from "../../../../apps/gateway/src/types";

const bearer = "ak_test_aaaaaaaaaaaaaaaa_" + "b".repeat(43);

function setup(authorize = jest.fn()) {
  authorize.mockResolvedValue({
    identity: {
      organizationId: "org",
      projectId: "prj_x",
      environmentId: "env_x",
      environmentKind: "test",
      applicationId: "app_x",
      credentialId: "crd_x",
    },
    capability: "email",
    action: "email:send",
    signedContext: "signed.context.token",
  });
  const fetchImpl = jest.fn().mockResolvedValue(
    new Response(JSON.stringify({ success: true }), {
      status: 201,
      headers: { "content-type": "application/json", "x-idempotency-replayed": "true", "set-cookie": "leak=1" },
    }),
  );
  const proxy = new ApplicationCapabilityProxy(
    { authorize } as unknown as ApplicationAccessService,
    new SharedServiceRoutingService({ SHARED_SERVICE_ROUTE_EMAIL_TEST: "http://email.internal:4012/" }),
    { fetchImpl, cloudRunAuthorizer: async () => undefined, timeoutMs: 1000 },
  );
  return { proxy, authorize, fetchImpl };
}

function request(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    method: "POST",
    path: "/api/v1/shared/email/send",
    originalUrl: "/api/v1/shared/email/send",
    query: {},
    body: { to: "a@example.test", subject: "Hi", text: "Hello" },
    correlationId: "corr-1",
    headers: {
      authorization: `Bearer ${bearer}`,
      "idempotency-key": "idem-key-0000000001",
      "x-tribe-id": "forged-tribe",
      "x-apicenter-project-id": "forged-project",
      "x-apicenter-context": "forged-context",
      cookie: "session=secret",
    },
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

function response() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 0,
    body: undefined as Buffer | undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    send(body: Buffer) {
      res.body = body;
    },
    headers,
  };
  return res;
}

describe("ApplicationCapabilityProxy", () => {
  it("forwards only the signed context and allowlisted headers, never the caller's key", async () => {
    const { proxy, authorize, fetchImpl } = setup();
    const res = response();
    await proxy.forward("email", bearer, request(), res as unknown as Response);

    expect(authorize).toHaveBeenCalledWith({ bearer, capability: "email", method: "POST", relativePath: "/send", requestId: "corr-1" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://email.internal:4012/send");
    expect(init.headers).toEqual({
      "X-APICenter-Context": "signed.context.token",
      "X-APICenter-Correlation-Id": "corr-1",
      "X-Correlation-ID": "corr-1",
      "X-Forwarded-By": "apicenter-gateway",
      "idempotency-key": "idem-key-0000000001",
      "Content-Type": "application/json",
    });
    expect(JSON.stringify(init)).not.toContain(bearer);
    expect(JSON.parse(init.body)).toEqual({ to: "a@example.test", subject: "Hi", text: "Hello" });

    expect(res.statusCode).toBe(201);
    expect(res.headers["x-idempotency-replayed"]).toBe("true");
    expect(res.headers).not.toHaveProperty("set-cookie");
  });

  it("routes by the environment of the credential, not anything the caller sends", async () => {
    const { proxy } = setup();
    await expect(
      proxy.forward("email", bearer, request({ query: { environment: "live" } as never }), response() as unknown as Response),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("does not call the runtime when authorization fails", async () => {
    const authorize = jest.fn();
    const { proxy, fetchImpl } = setup(authorize);
    authorize.mockReset().mockRejectedValue(Object.assign(new Error("denied"), { status: 403 }));
    await expect(proxy.forward("email", bearer, request(), response() as unknown as Response)).rejects.toThrow("denied");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an unreachable runtime as a bad gateway", async () => {
    const { proxy, fetchImpl } = setup();
    fetchImpl.mockRejectedValue(new TypeError("fetch failed"));
    await expect(proxy.forward("email", bearer, request(), response() as unknown as Response)).rejects.toMatchObject({ status: 502 });
  });
});

describe("relativeCapabilityPath", () => {
  it("strips the capability prefix", () => {
    expect(relativeCapabilityPath("/api/v1/shared/email/status/msg_1", "email")).toBe("/status/msg_1");
  });

  it.each(["/api/v1/shared/email/../admin", "/api/v1/shared/email/%2e%2e/admin", "/api/v1/shared/email/a%2Fb", "/api/v1/shared/sms/send"])(
    "rejects %s",
    (path) => {
      expect(() => relativeCapabilityPath(path, "email")).toThrow("Capability path is invalid");
    },
  );
});
