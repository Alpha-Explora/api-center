import { describe, expect, it } from "vitest";
import {
  summarizeSecretStatus,
  summarizeSharedServiceProviderConfigs,
} from "@/lib/secret-status";

describe("secret status route behavior", () => {
  it("returns key names and missing keys only", () => {
    const summary = summarizeSecretStatus({
      secretName: "api-shared-services-prod",
      exists: true,
      observedKeyNames: ["redis_url"],
      requiredKeyNames: ["redis_url", "paymongo_secret_key"],
    });

    expect(summary).toMatchObject({
      secretName: "api-shared-services-prod",
      exists: true,
      observedKeyNames: ["redis_url"],
      missingKeyNames: ["paymongo_secret_key"],
    });
  });

  it("returns schema-aware shared-service config metadata only", () => {
    const configs = summarizeSharedServiceProviderConfigs({
      secretName: "api-shared-services-prod",
      exists: true,
      observedKeyNames: ["paymongo_secret_key", "sms_provider"],
    });

    expect(configs.find((config) => config.serviceId === "payment")).toMatchObject({
      missingKeyNames: ["paymongo_live_mode", "paymongo_webhook_secret"],
      status: "missing",
    });
    expect(JSON.stringify(configs)).not.toContain("sk_live");
  });
});
