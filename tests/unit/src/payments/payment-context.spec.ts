import { generateKeyPairSync } from "node:crypto";
import { loadRuntimeContextKeys } from "@apicenter/runtime";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { readPaymentContext } from "../../../../apps/payments/src/shared/payment-context";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const contextKeys = loadRuntimeContextKeys(JSON.stringify([{ ...publicKey.export({ format: "jwk" }), kid: "k1" }])) as Map<string, unknown>;
const signer = new RuntimeContextSigner({
  APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k1" }),
});
const identity = {
  organizationId: "6f1c1d1e-0000-4000-8000-0000000000aa",
  projectId: "prj_shop",
  environmentId: "env_shop_live",
  environmentKind: "live" as const,
  applicationId: "app_shop",
  credentialId: "crd_shop",
};
const owner = { groupId: identity.organizationId, projectId: "prj_shop" };
const sign = (capability = "payments") =>
  signer.sign({ identity, resourceOwner: owner, capability, action: "payments:checkouts:create", requestId: "req-1" });
const request = (headers: Record<string, string>) => ({
  get: (name: string) => Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1],
});
const forged = {
  "X-APICenter-Owner-Tribe-ID": "6f1c1d1e-0000-4000-8000-0000000000ff",
  "X-APICenter-Project-ID": "prj_victim",
  "X-APICenter-Consumer-Service-ID": "app_victim",
  "X-APICenter-Environment": "live",
};
const verifying = { canVerify: true, production: true, contextKeys };

describe("readPaymentContext", () => {
  it("scopes a request by the gateway's signed context", () => {
    expect(readPaymentContext(request({ "X-APICenter-Context": sign() }), verifying)).toEqual({
      tribeId: identity.organizationId,
      projectId: "prj_shop",
      consumerServiceId: "app_shop",
      environment: "live",
    });
  });

  it("refuses unsigned identity headers once it can verify, so the runtime token alone names no project", () => {
    expect(() => readPaymentContext(request(forged), verifying)).toThrow("signed payment request context is required");
  });

  it("refuses headers that disagree with the signed context, and contexts for another runtime", () => {
    expect(() => readPaymentContext(request({ "X-APICenter-Context": sign(), ...forged }), verifying)).toThrow("do not match");
    expect(() => readPaymentContext(request({ "X-APICenter-Context": sign("email") }), verifying)).toThrow("could not be verified");
  });

  it("keeps the unsigned headers only while the runtime has no keys to verify with", () => {
    expect(readPaymentContext(request(forged), { canVerify: false, production: true })).toMatchObject({ projectId: "prj_victim" });
  });
});
