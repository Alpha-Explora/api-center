import { describe, expect, it } from "vitest";
import { formSchema } from "@/components/tribe-form/tribe-form-schema";
import { serviceRegistrationManifestSchema } from "@/lib/schemas";

const form = {
  serviceId: "sample-service", name: "Sample", serviceType: "tribe", projectId: "sample-project",
  version: "1.0.0", serviceTier: "standard", exposesText: "/health", requiredScopesText: "sample:read",
  environments: [{ environment: "test", baseUrl: "https://sample.example.test" }],
};

describe("registration environments and live approval", () => {
  it("accepts test without live approval fields", () => {
    expect(formSchema.parse(form).environments?.[0]?.environment).toBe("test");
  });
  it.each(["staging", "uat", "demo"])("rejects new registration in %s", (environment) => {
    const value = { ...form, environments: [{ environment, baseUrl: "https://sample.example.test" }] };
    expect(formSchema.safeParse(value).success).toBe(false);
    expect(serviceRegistrationManifestSchema.safeParse({
      serviceId: "sample-service", name: "Sample", projectId: "sample-project", baseUrl: "https://sample.example.test",
      requiredScopes: ["sample:read"], exposes: ["/health"], environments: value.environments,
    }).success).toBe(false);
  });
  it("requires every live approval field", () => {
    const live = { ...form, environments: [{ environment: "live", baseUrl: "https://sample.example.test" }] };
    expect(formSchema.safeParse(live).success).toBe(false);
    const approved = { ...live, liveTypedPhrase: "APPLY LIVE CHANGE", liveReason: "Launch", approvalRequestId: "approval-123" };
    expect(formSchema.safeParse(approved).success).toBe(true);
    for (const field of ["liveTypedPhrase", "liveReason", "approvalRequestId"]) {
      expect(formSchema.safeParse({ ...approved, [field]: "" }).success).toBe(false);
    }
  });
});
