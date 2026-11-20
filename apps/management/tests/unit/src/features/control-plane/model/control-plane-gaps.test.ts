import { describe, expect, it } from "vitest";
import { policyToForm, quotaPolicyChange, quotaPolicyName, tightensLivePolicy } from "@/features/control-plane/model/quota-edit";
import type { QuotaPolicy } from "@/features/control-plane/model/quotas";
import {
  ALL_EVENT_TYPES,
  eventTypesBody,
  eventTypesSummary,
  selectionChanges,
  selectionFrom,
  toggleEventType,
} from "@/features/control-plane/model/event-types";
import { webhookBody } from "@/features/control-plane/model/event-destinations";
import { outgoingForApplication, outgoingRequestSchema, rejectionReasonBody, type OutgoingRequest } from "@/features/control-plane/model/outgoing-requests";
import { audienceInput } from "@/features/control-plane/model/workload-bindings";

const policy = (patch: Partial<QuotaPolicy> = {}): QuotaPolicy => ({
  id: "qp_aaaaaaaaaaaaaaaaaaaaaaaa",
  scope: "project",
  projectId: "prj_aaaaaaaaaaaaaaaaaaaaaaaa",
  environmentKind: "live",
  capability: null,
  windowSeconds: 3_600,
  maxRequests: 1_000,
  mode: "enforce",
  status: "active",
  ...patch,
});

describe("editing a quota policy", () => {
  it("prefills presets and custom windows", () => {
    expect(policyToForm(policy())).toEqual({ capability: "", window: "3600", customSeconds: "", maxRequests: "1000", mode: "enforce" });
    expect(policyToForm(policy({ windowSeconds: 900, capability: "email", mode: "observe" }))).toEqual({
      capability: "email",
      window: "custom",
      customSeconds: "900",
      maxRequests: "1000",
      mode: "observe",
    });
  });

  it("sends only the fields that changed, and nothing when nothing did", () => {
    const current = policy({ capability: "email" });
    expect(quotaPolicyChange(current, policyToForm(current))).toEqual({ kind: "unchanged" });
    expect(quotaPolicyChange(current, { ...policyToForm(current), maxRequests: "2,000", capability: "" })).toEqual({
      kind: "change",
      change: { maxRequests: 2_000, capability: null },
    });
    expect(quotaPolicyChange(current, { ...policyToForm(current), window: "custom", customSeconds: "120", mode: "observe" })).toEqual({
      kind: "change",
      change: { windowSeconds: 120, mode: "observe" },
    });
  });

  it("reports invalid values like the create form", () => {
    expect(quotaPolicyChange(policy(), { ...policyToForm(policy()), maxRequests: "0" })).toMatchObject({ kind: "invalid", errors: { maxRequests: expect.any(String) } });
  });

  it("asks before tightening an active enforced live policy, and only then", () => {
    expect(tightensLivePolicy(policy(), { maxRequests: 10 })).toBe(true);
    expect(tightensLivePolicy(policy(), { windowSeconds: 86_400 })).toBe(true);
    expect(tightensLivePolicy(policy({ capability: "email" }), { capability: null })).toBe(true);
    expect(tightensLivePolicy(policy({ mode: "observe" }), { mode: "enforce" })).toBe(true);
    expect(tightensLivePolicy(policy(), { maxRequests: 5_000 })).toBe(false);
    expect(tightensLivePolicy(policy(), { mode: "observe", maxRequests: 1 })).toBe(false);
    expect(tightensLivePolicy(policy({ environmentKind: "test" }), { maxRequests: 1 })).toBe(false);
    expect(tightensLivePolicy(policy({ status: "disabled" }), { maxRequests: 1 })).toBe(false);
  });

  it("names a policy by its limit and capability", () => {
    expect(quotaPolicyName(policy())).toBe("1,000 requests / hour");
    expect(quotaPolicyName(policy({ capability: "sms", maxRequests: 1 }))).toBe("1 request / hour (sms)");
  });
});

describe("webhook event types", () => {
  const catalogue = [
    { type: "payment.checkout.paid", title: "Checkout paid", description: "" },
    { type: "payment.intent.paid", title: "Payment intent paid", description: "" },
    { type: "payment.intent.failed", title: "Payment intent failed", description: "" },
  ];

  it("treats an empty filter as every type", () => {
    expect(selectionFrom([])).toEqual(ALL_EVENT_TYPES);
    expect(eventTypesBody(ALL_EVENT_TYPES)).toEqual({ ok: true, eventTypes: [] });
    expect(eventTypesSummary([], catalogue)).toBe("All event types");
  });

  it("toggles types in catalogue order and refuses an empty choice", () => {
    let selection = toggleEventType(ALL_EVENT_TYPES, "payment.intent.failed", catalogue);
    selection = toggleEventType(selection, "payment.checkout.paid", catalogue);
    expect(selection).toEqual({ all: false, types: ["payment.checkout.paid", "payment.intent.failed"] });
    expect(eventTypesSummary(["payment.checkout.paid", "payment.intent.failed"], catalogue)).toBe("2 of 3 event types");
    expect(eventTypesSummary(["payment.intent.failed"], catalogue)).toBe("Payment intent failed");
    selection = toggleEventType(toggleEventType(selection, "payment.checkout.paid", catalogue), "payment.intent.failed", catalogue);
    expect(eventTypesBody(selection)).toEqual({ ok: false, error: expect.stringContaining("at least one") });
  });

  it("knows when a selection changes the stored filter", () => {
    expect(selectionChanges(ALL_EVENT_TYPES, [])).toBe(false);
    expect(selectionChanges({ all: false, types: ["payment.intent.paid"] }, ["payment.intent.paid"])).toBe(false);
    expect(selectionChanges({ all: false, types: ["payment.intent.paid"] }, [])).toBe(true);
    expect(selectionChanges(ALL_EVENT_TYPES, ["payment.intent.paid"])).toBe(true);
  });

  it("leaves an all-types filter out of the create body", () => {
    const form = { recipientApplicationId: "app_aaaaaaaaaaaaaaaaaaaaaaaa", url: "https://shop.example.com/hooks" };
    expect(webhookBody(form)).toEqual(form);
    expect(webhookBody(form, ["payment.intent.paid"])).toEqual({ ...form, eventTypes: ["payment.intent.paid"] });
  });
});

describe("outgoing API access requests", () => {
  const request = (patch: Partial<OutgoingRequest>): OutgoingRequest => ({
    id: "acr_1",
    apiId: "api_1",
    action: "orders:read",
    consumerProjectId: "prj_c",
    consumerEnvironmentId: "env_c",
    consumerApplicationId: "app_1",
    status: "pending",
    requestedBy: "dev@example.com",
    decidedBy: null,
    decidedAt: null,
    grantId: null,
    createdAt: "2026-11-10T00:00:00.000Z",
    api: { name: "Orders", slug: "orders", projectId: "prj_o", environmentKind: "test" },
    ...patch,
  });

  it("parses the gateway's rows, with or without an API", () => {
    const parsed = outgoingRequestSchema.parse({ ...request({}), rejectionReason: null, api: null, organizationId: "x" });
    expect(parsed.api).toBeNull();
  });

  it("shows one application's requests in this environment, pending first", () => {
    const rows = outgoingForApplication(
      [
        request({ id: "old-decided", status: "rejected", decidedAt: "2026-11-11T00:00:00.000Z" }),
        request({ id: "new-decided", status: "approved", decidedAt: "2026-11-12T00:00:00.000Z" }),
        request({ id: "pending-late", createdAt: "2026-11-13T00:00:00.000Z" }),
        request({ id: "pending-early", createdAt: "2026-11-09T00:00:00.000Z" }),
        request({ id: "other-app", consumerApplicationId: "app_2" }),
        request({ id: "live", api: { name: "Orders", slug: "orders", projectId: "prj_o", environmentKind: "live" } }),
      ],
      "app_1",
      "test",
    );
    expect(rows.map((row) => row.id)).toEqual(["pending-early", "pending-late", "new-decided", "old-decided"]);
  });

  it("sends a trimmed rejection reason, or none", () => {
    expect(rejectionReasonBody("  use v2  ")).toEqual({ reason: "use v2" });
    expect(rejectionReasonBody("   ")).toEqual({});
    expect(rejectionReasonBody("x".repeat(600)).reason).toHaveLength(500);
  });
});

describe("workload audiences", () => {
  it("offers a select of the gateway's audiences, and free text when it lists none", () => {
    expect(audienceInput(["https://a.example", " https://a.example ", "aud-b"])).toEqual({ kind: "select", audiences: ["https://a.example", "aud-b"] });
    expect(audienceInput([])).toEqual({ kind: "text" });
    expect(audienceInput(undefined)).toEqual({ kind: "text" });
  });
});
