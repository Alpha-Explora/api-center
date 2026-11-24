// A test send to a recipient the project has not registered is recorded and never delivered.

import { generateKeyPairSync } from "node:crypto";
import { loadRuntimeContextKeys, verifyRuntimeContext, type SharedServiceCaller } from "@apicenter/runtime";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { GenerateOtpService } from "../../../../apps/otp/src/features/generate-otp/generate-otp.service";
import { MemoryOtpStore } from "../../../../apps/otp/src/shared/otp-store";
import { SendSmsService } from "../../../../apps/sms/src/features/send-sms/send-sms.service";

const suppressed: SharedServiceCaller = {
  tribeId: "org-a",
  projectId: "project-a",
  serviceId: "app-a",
  environment: "test",
  model: "application",
  suppressDelivery: true,
};

describe("suppressed test delivery", () => {
  const savedNodeEnv = process.env.NODE_ENV;
  const savedOtpMode = process.env.OTP_DELIVERY_MODE;
  beforeEach(() => {
    // As in production: no mock mode, so only suppression can keep these from the providers.
    process.env.NODE_ENV = "production";
    process.env.OTP_HASH_SECRET = "test-only-otp-hash-secret";
    delete process.env.OTP_DELIVERY_MODE;
  });
  afterAll(() => {
    process.env.NODE_ENV = savedNodeEnv;
    delete process.env.OTP_HASH_SECRET;
    if (savedOtpMode === undefined) delete process.env.OTP_DELIVERY_MODE;
    else process.env.OTP_DELIVERY_MODE = savedOtpMode;
  });

  it("records an SMS without calling the provider", async () => {
    const provider = { send: jest.fn() };
    const store = { save: jest.fn().mockResolvedValue(undefined), getProjectSender: jest.fn().mockResolvedValue(null), reserveDailySend: jest.fn() };
    const result = await new SendSmsService(store as never, provider as never).execute({ to: "+639170000000", message: "hello" }, suppressed);

    expect(provider.send).not.toHaveBeenCalled();
    expect(store.reserveDailySend).not.toHaveBeenCalled();
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ to: "+639170000000" }), suppressed);
    expect(result.status).toBe("queued");
  });

  it("issues an OTP without sending it, and returns the code so tests can verify it", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    const store = new MemoryOtpStore();
    const generated = await new GenerateOtpService(store).execute({ channel: "sms", recipient: "+639170000000" }, suppressed);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(generated.code).toMatch(/^\d{6}$/);
    fetchSpy.mockRestore();
  });
});

describe("the suppression claim", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keys = loadRuntimeContextKeys(JSON.stringify([{ ...publicKey.export({ format: "jwk" }), kid: "k" }])) as Map<string, unknown>;
  const signer = new RuntimeContextSigner({
    APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k" }),
  });
  const identity = (environmentKind: "test" | "live") => ({
    organizationId: "6f1c1d1e-0000-4000-8000-0000000000aa",
    projectId: "prj_a",
    environmentId: `env_${environmentKind}`,
    environmentKind,
    applicationId: "app_a",
    credentialId: "crd_a",
  });
  const read = (environmentKind: "test" | "live", delivery?: "suppress") =>
    (verifyRuntimeContext(
      signer.sign({ identity: identity(environmentKind), capability: "sms", action: "sms:send", requestId: "r", ...(delivery ? { delivery } : {}) }),
      { audience: "apicenter-runtime:sms", keys },
    ) as { suppressDelivery: boolean }).suppressDelivery;

  it("applies only to test contexts that carry it", () => {
    expect(read("test", "suppress")).toBe(true);
    expect(read("test")).toBe(false);
    expect(read("live", "suppress")).toBe(false);
  });
});
