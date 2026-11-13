// Every shared-service runtime accepts a valid signed context for its own audience and rejects
// tampered or misaddressed contexts. Legacy header callers are covered by runtime-apps.spec.ts.

import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { callerIdempotencyScope, createRuntimeContextGate } from "@apicenter/runtime";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.NODE_ENV = "development";
delete process.env.DATABASE_URL;
process.env.SMS_PROVIDER_MODE = "mock";
process.env.OTP_DELIVERY_MODE = "mock";
process.env.APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS = JSON.stringify([{ ...publicKey.export({ format: "jwk" }), kid: "k1" }]);

const signer = new RuntimeContextSigner({
  APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k1" }),
});
const identity = {
  organizationId: "6f1c1d1e-0000-4000-8000-0000000000bb",
  projectId: "prj_aaaaaaaaaaaaaaaaaaaaaaaa",
  environmentId: "env_aaaaaaaaaaaaaaaaaaaaaaaa",
  environmentKind: "test" as const,
  applicationId: "app_aaaaaaaaaaaaaaaaaaaaaaaa",
  credentialId: "crd_aaaaaaaaaaaaaaaaaaaaaaaa",
};

type App = { listen: (port: number, callback: () => void) => { address(): { port: number }; close(cb: () => void): void } };
const apps = new Map<string, App>();

beforeAll(() => {
  for (const service of ["sms", "otp", "geo"]) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    apps.set(service, (require(path.resolve(__dirname, `../../../../apps/${service}/src/server.ts`)) as { app: App }).app);
  }
}, 180000);

async function call(service: string, endpoint: string, context: string, body: unknown, idempotencyKey?: string) {
  const app = apps.get(service)!;
  const server = await new Promise<ReturnType<App["listen"]>>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-APICenter-Context": context,
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
    return response.status;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function contextFor(capability: string, action: string) {
  return signer.sign({ identity, capability, action, requestId: `req-${capability}` });
}

function tamper(token: string) {
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return `${header}.${Buffer.from(JSON.stringify({ ...claims, prj: "prj_bbbbbbbbbbbbbbbbbbbbbbbb" })).toString("base64url")}.${signature}`;
}

const cases = [
  { service: "sms", endpoint: "/send", action: "sms:send", body: { to: "+639171234567", message: "Hello" }, idempotent: true },
  { service: "otp", endpoint: "/generate", action: "otp:generate", body: { target: "user@example.test", channel: "email" }, idempotent: true },
  { service: "geo", endpoint: "/geofence/check", action: "geo:geofence", body: { latitude: 14.6, longitude: 121 }, idempotent: false },
];

describe.each(cases)("$service runtime", ({ service, endpoint, action, body, idempotent }) => {
  const key = idempotent ? `adoption-${service}-key-000001` : undefined;

  it("accepts a valid context for its audience", async () => {
    expect(await call(service, endpoint, contextFor(service, action), body, key)).toBeLessThan(300);
  }, 30000);

  it("rejects a tampered context", async () => {
    expect(await call(service, endpoint, tamper(contextFor(service, action)), body, key)).toBe(403);
  }, 30000);

  it("rejects a context addressed to another runtime", async () => {
    expect(await call(service, endpoint, contextFor("email", "email:send"), body, key)).toBe(403);
  }, 30000);
});

describe("runtime helpers", () => {
  it("scopes idempotency by the verified application, ignoring legacy headers", () => {
    const req = { get: (name: string) => ({ "X-Tribe-Id": "forged", "X-APICenter-Source-Service-Id": "forged" })[name] };
    expect(
      callerIdempotencyScope({ model: "application", tribeId: "org", projectId: "prj", serviceId: "app_x", environment: "test" }, req),
    ).toEqual({ sourceServiceId: "app_x", tribeId: "org", environment: "test" });
    expect(callerIdempotencyScope({ tribeId: "t", projectId: "p", serviceId: "s", environment: "test" }, req)).toEqual({
      sourceServiceId: "forged",
      tribeId: "forged",
      environment: undefined,
    });
  });

  it("lets requests without a context through the gate and rejects invalid ones", () => {
    const gate = createRuntimeContextGate("apicenter-runtime:geo");
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    gate({ get: () => undefined }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    gate({ get: (name: string) => (name === "X-APICenter-Context" ? "garbage" : undefined) }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
