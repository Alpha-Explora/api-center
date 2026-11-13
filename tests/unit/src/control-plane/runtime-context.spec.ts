import { generateKeyPairSync } from "node:crypto";
import {
  RuntimeContextError,
  loadRuntimeContextKeys,
  readSharedServiceCaller,
  verifyRuntimeContext,
  SharedServiceCallerError,
} from "@apicenter/runtime";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import type { ApplicationIdentity } from "../../../../apps/gateway/src/domains/control-plane/control-plane.types";

function keyPair(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privateJwk = { ...privateKey.export({ format: "jwk" }), kid };
  const publicJwk = { ...publicKey.export({ format: "jwk" }), kid };
  return { privateJwk, publicJwk };
}

const primary = keyPair("ctx-2026-11");
const other = keyPair("ctx-other");
const signer = new RuntimeContextSigner({ APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify(primary.privateJwk) });
const keys = loadRuntimeContextKeys(JSON.stringify([primary.publicJwk]));

const identity: ApplicationIdentity = {
  organizationId: "6f1c1d1e-0000-4000-8000-000000000001",
  projectId: "prj_aaaaaaaaaaaaaaaaaaaaaaaa",
  environmentId: "env_bbbbbbbbbbbbbbbbbbbbbbbb",
  environmentKind: "test",
  applicationId: "app_cccccccccccccccccccccccc",
  credentialId: "crd_dddddddddddddddddddddddd",
};
const issuedAt = new Date("2026-11-14T10:00:00Z");

function sign(capability = "email") {
  return signer.sign({ identity, capability, action: "email:send", requestId: "req-1", now: issuedAt });
}

function requestWith(values: Record<string, string>) {
  return { get: (name: string) => values[name] };
}

describe("runtime context", () => {
  it("verifies a gateway-signed context for the intended runtime", () => {
    expect(verifyRuntimeContext(sign(), { audience: "apicenter-runtime:email", keys, now: issuedAt.getTime() + 30_000 })).toEqual({
      requestId: "req-1",
      organizationId: identity.organizationId,
      projectId: identity.projectId,
      environmentId: identity.environmentId,
      environmentKind: "test",
      applicationId: identity.applicationId,
      action: "email:send",
    });
  });

  it("rejects a context signed for a different runtime", () => {
    expect(() => verifyRuntimeContext(sign("sms"), { audience: "apicenter-runtime:email", keys, now: issuedAt.getTime() }))
      .toThrow("audience");
  });

  it("rejects an expired context", () => {
    expect(() => verifyRuntimeContext(sign(), { audience: "apicenter-runtime:email", keys, now: issuedAt.getTime() + 120_000 }))
      .toThrow("expired");
  });

  it("rejects a tampered payload", () => {
    const [header, payload, signature] = sign().split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const forged = Buffer.from(JSON.stringify({ ...claims, prj: "prj_zzzzzzzzzzzzzzzzzzzzzzzz" })).toString("base64url");
    expect(() => verifyRuntimeContext(`${header}.${forged}.${signature}`, { audience: "apicenter-runtime:email", keys, now: issuedAt.getTime() }))
      .toThrow("signature");
  });

  it("rejects a context from an untrusted key", () => {
    const untrusted = new RuntimeContextSigner({ APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify(other.privateJwk) });
    const token = untrusted.sign({ identity, capability: "email", action: "email:send", requestId: "r", now: issuedAt });
    expect(() => verifyRuntimeContext(token, { audience: "apicenter-runtime:email", keys, now: issuedAt.getTime() }))
      .toThrow("not trusted");
  });

  it("rejects alg confusion and unsigned tokens", () => {
    const [, payload] = sign().split(".");
    const none = Buffer.from(JSON.stringify({ alg: "none", typ: "apicenter-context+jwt", kid: "ctx-2026-11" })).toString("base64url");
    expect(() => verifyRuntimeContext(`${none}.${payload}.x`, { audience: "apicenter-runtime:email", keys, now: issuedAt.getTime() }))
      .toThrow(RuntimeContextError);
  });

  it("refuses a public key set that contains private key material", () => {
    expect(() => loadRuntimeContextKeys(JSON.stringify([primary.privateJwk]))).toThrow("private key material");
  });

  it("fails closed when signing is not configured", () => {
    expect(() => new RuntimeContextSigner({}).sign({ identity, capability: "email", action: "email:send", requestId: "r" }))
      .toThrow("not configured");
  });
});

describe("readSharedServiceCaller with a signed context", () => {
  const options = { production: true, runtimeAudience: "apicenter-runtime:email", contextKeys: keys, now: issuedAt.getTime() };

  it("takes identity only from the verified context and ignores forged legacy headers", () => {
    const caller = readSharedServiceCaller(
      requestWith({
        "X-APICenter-Context": sign(),
        "X-Tribe-Id": "victim-tribe",
        "X-APICenter-Project-Id": "victim-project",
        "X-APICenter-Source-Service-Id": "victim-service",
        "X-APICenter-Environment": "live",
      }),
      options,
    );
    expect(caller).toMatchObject({
      model: "application",
      tribeId: identity.organizationId,
      projectId: identity.projectId,
      serviceId: identity.applicationId,
      environment: "test",
    });
  });

  it("rejects an invalid context instead of falling back to legacy headers", () => {
    expect(() =>
      readSharedServiceCaller(
        requestWith({
          "X-APICenter-Context": "not-a-token",
          "X-Tribe-Id": "tribe-a",
          "X-APICenter-Project-Id": "project-a",
          "X-APICenter-Source-Service-Id": "service-a",
          "X-APICenter-Environment": "test",
        }),
        options,
      ),
    ).toThrow(SharedServiceCallerError);
  });

  it("rejects a signed context in a runtime that has not configured an audience", () => {
    expect(() => readSharedServiceCaller(requestWith({ "X-APICenter-Context": sign() }), { production: true, contextKeys: keys }))
      .toThrow("audience");
  });

  it("keeps the legacy header path unchanged when no context is present", () => {
    expect(
      readSharedServiceCaller(
        requestWith({
          "X-Tribe-Id": "tribe-a",
          "X-APICenter-Project-Id": "project-a",
          "X-APICenter-Source-Service-Id": "service-a",
          "X-APICenter-Environment": "test",
        }),
        options,
      ),
    ).toEqual({ tribeId: "tribe-a", projectId: "project-a", serviceId: "service-a", environment: "test" });
  });
});
