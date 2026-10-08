import { describe, expect, it } from "vitest";
import {
  buildQuotaProposedActions,
  buildRegistryProposedActions,
  buildServiceProposedActions,
} from "../../../../src/lib/proposed-actions";
import type {
  ConfluentPipelineStatusResponse,
  QuotaPolicy,
  QuotaUsageDecision,
  ServiceRegistryEntry,
  TribeSecretStatusResponse,
} from "@/lib/schemas";

const tribe: ServiceRegistryEntry = {
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
  consumes: ["payment"],
  exposes: ["/health"],
  requiredScopes: ["shared:payment:invoke"],
  status: "active",
  registeredAt: "2026-05-17T00:00:00.000Z",
  updatedAt: "2026-05-17T01:00:00.000Z",
};

describe("proposed actions", () => {
  it("generates registry proposals for missing shared-service manifests", () => {
    const actions = buildRegistryProposedActions([tribe]);

    expect(actions.map((action) => action.id)).toContain(
      "register-shared-service-payment",
    );
    expect(actions[0]).toMatchObject({
      execution: "proposal",
      risk: "state-write",
    });
  });

  it("generates service proposals from pipeline and stale secret state", () => {
    const pipelineStatus: ConfluentPipelineStatusResponse["data"] = {
      serviceId: "flow-ci",
      topicName: "tribe.flow-ci.events",
      topicCheckOk: true,
      topicExists: true,
      s3SinkCheckOk: true,
      s3SinkIncludesTopic: false,
      connectorName: "api-center-s3-sink",
      topics: [],
    };
    const secretStatus: TribeSecretStatusResponse["data"] = {
      serviceId: "flow-ci",
      secretId: "api-center-tribe-secret-flow-ci",
      exists: true,
      enabled: true,
      rotationWarning: {
        stale: true,
        severity: "warning",
        message: "Rotate this tribe secret.",
      },
    };

    const actions = buildServiceProposedActions({
      service: tribe,
      pipelineStatus,
      secretStatus,
    });

    expect(actions.map((action) => action.id)).toEqual([
      "flow-ci-add-topic-to-s3-sink",
      "flow-ci-rotate-stale-secret",
    ]);
    expect(actions.map((action) => action.href)).toEqual([
      "/tribes/flow-ci?section=pipeline",
      "/tribes/flow-ci?section=actions",
    ]);
    expect(actions.every((action) => action.execution === "proposal")).toBe(
      true,
    );
  });

  it("generates quota proposals from policy gaps and quota decisions", () => {
    const productionTribe: ServiceRegistryEntry = {
      ...tribe,
      serviceId: "campus-one",
      projectId: "campus-one-default",
      ownerTribeId: "campus-one",
      serviceTier: "critical",
      status: "active",
    };
    const sameProjectService: ServiceRegistryEntry = {
      ...productionTribe,
      serviceId: "campus-one-admin",
    };
    const providerSensitiveSharedService: ServiceRegistryEntry = {
      ...tribe,
      serviceId: "payment",
      ownerTribeId: undefined,
      serviceType: "shared",
      quotaHints: {
        recommendedWindowSeconds: 60,
        recommendedMaxRequests: 100,
        providerCostSensitive: true,
        notes: "Payment provider calls have direct cost impact.",
      },
    };
    const policies: QuotaPolicy[] = [
      {
        id: "quota-observe",
        ownerTribeId: "logistics",
        scope: "shared",
        targetServiceId: "email",
        windowSeconds: 60,
        maxRequests: 100,
        burstRequests: null,
        mode: "observe",
        status: "active",
        reason: "Observe first",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
      {
        id: "quota-enforce",
        ownerTribeId: "billing",
        scope: "shared",
        targetServiceId: "email",
        windowSeconds: 60,
        maxRequests: 100,
        burstRequests: null,
        mode: "enforce",
        status: "active",
        reason: "Provider protection",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
    ];
    const usage: QuotaUsageDecision[] = [
      quotaDecision({
        id: "observed-1",
        ownerTribeId: "logistics",
        policyId: "quota-observe",
        mode: "observe",
        outcome: "observed_exceeded",
        createdAt: "2026-05-25T00:30:00.000Z",
      }),
      quotaDecision({
        id: "blocked-1",
        ownerTribeId: "billing",
        policyId: "quota-enforce",
        mode: "enforce",
        outcome: "blocked",
        createdAt: "2026-05-25T00:45:00.000Z",
      }),
      quotaDecision({
        id: "allowed-1",
        ownerTribeId: "billing",
        policyId: "quota-enforce",
        mode: "enforce",
        outcome: "allowed",
        createdAt: "2026-05-25T00:46:00.000Z",
      }),
    ];

    const actions = buildQuotaProposedActions({
      services: [productionTribe, sameProjectService, providerSensitiveSharedService],
      policies,
      usage,
      now: new Date("2026-05-25T01:00:00.000Z"),
    });

    expect(actions.map((action) => action.id)).toEqual([
      "campus-one-default-create-active-quota",
      "logistics-review-observe-quota-exceeded",
      "billing-review-enforced-quota-blocks",
      "payment-create-target-quota",
    ]);
    expect(actions.map((action) => action.href)).toEqual([
      "/quotas?ownerTribeId=campus-one&projectId=campus-one-default",
      "/quotas?ownerTribeId=logistics",
      "/quotas?ownerTribeId=billing",
      "/tribes/payment?section=quotas",
    ]);
  });

  it("treats a tribe-wide ceiling as quota coverage for every project in the tribe", () => {
    const actions = buildQuotaProposedActions({
      services: [
        {
          ...tribe,
          serviceId: "campus-one",
          projectId: "campus-one-default",
          ownerTribeId: "campus-one",
          serviceTier: "critical",
          status: "active",
        },
      ],
      policies: [
        {
          id: "campus-ceiling",
          ownerTribeId: "campus-one",
          scope: "all",
          targetServiceId: null,
          windowSeconds: 86400,
          maxRequests: 50000,
          burstRequests: null,
          mode: "observe",
          status: "active",
          reason: "Tribe ceiling",
          updatedAt: "2026-05-25T00:00:00.000Z",
        },
      ],
      usage: [],
      now: new Date("2026-05-25T01:00:00.000Z"),
    });

    expect(actions.map((action) => action.id)).not.toContain(
      "campus-one-default-create-active-quota",
    );
  });
});

function quotaDecision(
  overrides: Partial<QuotaUsageDecision>,
): QuotaUsageDecision {
  return {
    id: "decision",
    ownerTribeId: "logistics",
    policyId: "quota",
    scope: "shared",
    targetServiceId: "payment",
    routeFamily: "shared:payment",
    windowStart: "2026-05-25T00:00:00.000Z",
    windowEnd: "2026-05-25T00:01:00.000Z",
    requestCount: 101,
    maxRequests: 100,
    mode: "observe",
    outcome: "allowed",
    correlationId: "corr",
    createdAt: "2026-05-25T00:00:30.000Z",
    ...overrides,
  };
}
