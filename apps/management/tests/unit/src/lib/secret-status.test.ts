import { describe, expect, it } from "vitest";
import {
  getTribeSecretRotationWarning,
  sharedServiceProviderConfigSchemas,
  summarizeSecretStatus,
} from "../../../../src/lib/secret-status";

describe("summarizeSecretStatus", () => {
  it("marks missing key names without exposing values", () => {
    const summary = summarizeSecretStatus({
      secretName: "api-shared-services-prod",
      exists: true,
      latestEnabledVersion: "4",
      observedKeyNames: ["redis_url", "paymongo_secret_key"],
      requiredKeyNames: ["redis_url", "paymongo_secret_key", "paymongo_webhook_secret"],
    });

    expect(summary.missingKeyNames).toEqual(["paymongo_webhook_secret"]);
    expect(JSON.stringify(summary)).not.toContain("sk_");
  });

  it("uses allowlisted shared-service provider config schemas", () => {
    expect(sharedServiceProviderConfigSchemas.payment.requiredKeyNames).toContain(
      "paymongo_secret_key",
    );
    expect(sharedServiceProviderConfigSchemas.sms.requiredKeyNames).toContain(
      "sms_provider",
    );
    expect(JSON.stringify(sharedServiceProviderConfigSchemas)).not.toContain(
      "secret_value",
    );
  });

  it("flags stale tribe secrets from latest version timestamps", () => {
    const warning = getTribeSecretRotationWarning({
      exists: true,
      enabled: true,
      latestVersionCreatedAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-05-18T00:00:00.000Z"),
    });

    expect(warning).toMatchObject({
      stale: true,
      severity: "warning",
    });
  });

  it("flags a service secret that is still the credential copied from its tribe", () => {
    const warning = getTribeSecretRotationWarning({
      exists: true,
      enabled: true,
      latestVersionCreatedAt: "2026-05-17T00:00:00.000Z",
      inheritedFromTribeSecret: true,
      now: new Date("2026-05-18T00:00:00.000Z"),
    });

    expect(warning).toMatchObject({ stale: true, severity: "warning" });
    expect(warning.message).toContain("copied from its tribe");
  });
});
