import { describe, expect, it } from "vitest";
import {
  buildAccessReviewEvidence,
  formatAccessReviewEvidenceExport,
} from "../../../../src/lib/access-review";
import type { ServiceRegistryEntry, SharedServiceRuntimeUsage } from "@/lib/schemas";

const services: ServiceRegistryEntry[] = [
  {
    serviceId: "flow-ci",
    name: "Flow CI",
    version: "1.0.0",
    baseUrl: "https://flow-ci.example.com",
    healthCheck: "/health",
    serviceType: "tribe",
    ownerTeam: "Flow",
    contact: "ops@example.com",
    tags: [],
    serviceTier: "standard",
    consumes: ["payment", "sms"],
    exposes: ["/health"],
    requiredScopes: ["shared:payment:invoke", "shared:sms:invoke"],
    status: "active",
    registeredAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T01:00:00.000Z",
  },
  {
    serviceId: "payment",
    name: "Payment",
    version: "1.0.0",
    baseUrl: "https://payment.example.com",
    healthCheck: "/health",
    serviceType: "shared",
    ownerTeam: "Platform",
    contact: "platform@example.com",
    tags: [],
    serviceTier: "critical",
    consumes: [],
    exposes: ["/health"],
    requiredScopes: ["shared:payment:invoke"],
    status: "active",
    registeredAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T01:00:00.000Z",
  },
];

const runtimeUsage: SharedServiceRuntimeUsage[] = [
  {
    tribeServiceId: "flow-ci",
    sharedServiceId: "payment",
    window: "24h",
    totalRequests: 10,
    successRequests: 8,
    failedRequests: 2,
    errorRate: 0.2,
    avgLatencyMs: 100,
    lastUsedAt: "2026-05-18T00:00:00.000Z",
  },
];

describe("access review evidence", () => {
  it("builds ownership and usage rows with unused access warnings", () => {
    const evidence = buildAccessReviewEvidence({ services, runtimeUsage });

    expect(evidence.rows).toHaveLength(2);
    expect(evidence.rows[0]).toMatchObject({
      tribeServiceId: "flow-ci",
      sharedServiceId: "payment",
      ownerTeam: "Flow",
      deniedAttempts: 2,
      unusedAccess: false,
    });
    expect(evidence.rows[1]).toMatchObject({
      sharedServiceId: "sms",
      lastUsedAt: undefined,
      unusedAccess: true,
    });
  });

  it("exports redacted access review evidence", () => {
    const json = formatAccessReviewEvidenceExport(
      buildAccessReviewEvidence({ services, runtimeUsage }),
    );

    expect(json).toContain('"tribeServiceId": "flow-ci"');
    expect(json).not.toContain("secret");
    expect(json).not.toContain("token");
  });
});
