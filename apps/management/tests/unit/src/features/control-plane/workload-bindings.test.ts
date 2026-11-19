import { describe, expect, it } from "vitest";
import { workloadBindingFormToBody } from "@/features/control-plane/model/workload-bindings";

describe("workload binding form", () => {
  it("trims values and omits an empty description", () => {
    expect(workloadBindingFormToBody({ subject: " 104729384756 ", audience: " https://api.example.com ", description: "  " })).toEqual({
      ok: true,
      body: { subject: "104729384756", audience: "https://api.example.com" },
    });
  });

  it("keeps a description", () => {
    const result = workloadBindingFormToBody({ subject: "123456", audience: "aud", description: "Billing worker" });
    expect(result).toEqual({ ok: true, body: { subject: "123456", audience: "aud", description: "Billing worker" } });
  });

  it("accepts only a 6 to 32 digit unique ID, with a hint when an email is pasted", () => {
    for (const subject of ["12345", "1".repeat(33), "12345a", ""]) {
      const result = workloadBindingFormToBody({ subject, audience: "aud", description: "" });
      expect(result.ok, subject).toBe(false);
    }
    const email = workloadBindingFormToBody({ subject: "worker@project.iam.gserviceaccount.com", audience: "aud", description: "" });
    expect(!email.ok && email.errors.subject).toMatch(/not its email/);
    expect(workloadBindingFormToBody({ subject: "1".repeat(32), audience: "aud", description: "" }).ok).toBe(true);
  });

  it("requires an audience and bounds the lengths", () => {
    const result = workloadBindingFormToBody({ subject: "123456", audience: "", description: "x".repeat(201) });
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["audience", "description"]);
    expect(workloadBindingFormToBody({ subject: "123456", audience: "a".repeat(2049), description: "" }).ok).toBe(false);
  });
});
