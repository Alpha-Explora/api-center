import { describe, expect, it } from "vitest";
import {
  confluentTopicNameSchema,
  platformLifecycleResponseSchema,
  rawToSilverRunRequestSchema,
  rawToSilverRunResponseSchema,
  pipelineFeedbackActionRequestSchema,
  registryListResponseSchema,
  serviceManifestSchema,
  topicMigrationRequestSchema,
  tribeSecretProvisionRequestSchema,
} from "../../../../src/lib/schemas";

describe("confluentTopicNameSchema", () => {
  it("accepts test-prefixed tribe event topics", () => {
    expect(confluentTopicNameSchema.parse("test.tribe.flow-ci.events")).toBe(
      "test.tribe.flow-ci.events",
    );
  });

  it("accepts live-prefixed shared-service export topics", () => {
    expect(
      confluentTopicNameSchema.parse("prod.api-center.shared.payment.events"),
    ).toBe("prod.api-center.shared.payment.events");
  });

  it("accepts canonical topic owners with dots or underscores", () => {
    expect(confluentTopicNameSchema.parse("tribe.flow_ci.events")).toBe(
      "tribe.flow_ci.events",
    );
    expect(confluentTopicNameSchema.parse("prod.tribe.flow.ci.events")).toBe(
      "prod.tribe.flow.ci.events",
    );
  });

  it("rejects operational topics and unstable topic owners", () => {
    expect(() =>
      confluentTopicNameSchema.parse("prod.api-center.audit.log"),
    ).toThrow();
    expect(() =>
      confluentTopicNameSchema.parse("prod.tribe.flow..ci.events"),
    ).toThrow();
  });
});


describe("tribeSecretProvisionRequestSchema", () => {
  it("requires owner tribe, source service, and target environment", () => {
    expect(
      tribeSecretProvisionRequestSchema.parse({
        tribeId: "church-donations",
        sourceServiceId: "spark-site",
        environment: "live",
        secretHashSha256: "a".repeat(64),
      }),
    ).toMatchObject({
      tribeId: "church-donations",
      sourceServiceId: "spark-site",
      environment: "live",
    });

    expect(() =>
      tribeSecretProvisionRequestSchema.parse({
        serviceId: "spark-site",
        secretHashSha256: "a".repeat(64),
      }),
    ).toThrow();
  });
});
describe("serviceManifestSchema", () => {
  it("accepts multiple platform-approved service environments", () => {
    const parsed = serviceManifestSchema.parse({
      serviceId: "trinithrive",
      ownerTribeId: "trinithrive",
      name: "TriniThrive",
      baseUrl: "https://trinithrive-test.example.com",
      requiredScopes: ["service:read"],
      exposes: ["/health"],
      environments: [
        {
          environment: "test",
          baseUrl: "https://trinithrive-test.example.com",
          healthCheck: "/health",
        },
        {
          environment: "staging",
          baseUrl: "https://trinithrive-staging.example.com",
          healthCheck: "/health",
        },
      ],
    });

    expect(parsed.environments).toHaveLength(2);
    expect(parsed.environments?.[1]).toMatchObject({
      environment: "staging",
      baseUrl: "https://trinithrive-staging.example.com",
    });
  });

  it("accepts ownerTribeId for microservices owned by a tribe", () => {
    expect(
      serviceManifestSchema.parse({
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
        name: "Logistics Orders",
        baseUrl: "http://logistics-orders:3000",
        requiredScopes: ["orders:read"],
        exposes: ["/orders"],
      }).ownerTribeId,
    ).toBe("logistics");
  });

  it("rejects likely tribe microservices without ownerTribeId", () => {
    expect(() =>
      serviceManifestSchema.parse({
        serviceId: "logistics-orders",
        name: "Logistics Orders",
        baseUrl: "http://logistics-orders:3000",
        requiredScopes: ["orders:read"],
        exposes: ["/orders"],
      }),
    ).toThrow("ownerTribeId is required");
  });

  it("accepts root tribe services without ownerTribeId", () => {
    expect(
      serviceManifestSchema.parse({
        serviceId: "logistics",
        name: "Logistics",
        baseUrl: "http://logistics:3000",
        requiredScopes: ["logistics:read"],
        exposes: ["/health"],
      }).serviceId,
    ).toBe("logistics");
  });

  it("accepts shared services without ownerTribeId", () => {
    expect(
      serviceManifestSchema.parse({
        serviceId: "payment",
        serviceType: "shared",
        name: "Payment",
        baseUrl: "http://payment:3000",
        requiredScopes: ["payment:charge"],
        exposes: ["/shared/payment"],
      }).serviceType,
    ).toBe("shared");
  });
});

describe("registryListResponseSchema", () => {
  it("normalizes nullable registry metadata from API Center", () => {
    const parsed = registryListResponseSchema.parse({
      success: true,
      data: [
        {
          serviceId: "codex-owner-20260520024731",
          name: "Codex Owner Tribe",
          baseUrl: "https://api-center.itsandbox.site",
          requiredScopes: ["codex-owner:read"],
          exposes: ["/events"],
          consumes: ["kafka"],
          ownerTribeId: "codex-owner-20260520024731",
          serviceType: "tribe",
          serviceTier: null,
          costCenter: null,
          registeredAt: "2026-05-19T18:47:40.562Z",
          updatedAt: "2026-05-21T18:49:00.614Z",
          status: "active",
        },
      ],
    });

    expect(parsed.data[0].serviceTier).toBe("standard");
    expect(parsed.data[0].costCenter).toBeUndefined();
  });
});

describe("platformLifecycleResponseSchema", () => {
  it("accepts source-backed lifecycle evidence from API Center", () => {
    const parsed = platformLifecycleResponseSchema.parse({
      success: true,
      data: {
        generatedAt: "2026-06-14T02:00:00.000Z",
        summary: {
          total: 1,
          blocked: 0,
          attention: 0,
          ready: 1,
        },
        entries: [
          {
            service: {
              serviceId: "student-api",
              name: "Student API",
              baseUrl: "https://students.example.test",
              requiredScopes: ["students:read", "external:kafka:write"],
              exposes: ["/students"],
              consumes: ["kafka"],
              ownerTribeId: "campus-one",
              serviceType: "tribe",
              healthCheck: "/health",
              version: "1.0.0",
              registeredAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-14T00:00:00.000Z",
              status: "active",
              ownerTeam: "Campus",
              contact: "campus@example.test",
              healthy: true,
            },
            ownerTribeId: "campus-one",
            status: "ready",
            blockedCount: 0,
            attentionCount: 0,
            stages: [
              {
                id: "pipeline",
                label: "Pipeline",
                status: "complete",
                evidence: "1 prod pipeline-health row is available.",
                source: "pipeline-health",
                action: "Review pipeline evidence.",
                href: "/tribes/student-api?section=pipeline",
              },
            ],
            nextAction: {
              stageId: "registry",
              label: "Open the service detail record.",
              href: "/tribes/student-api",
            },
          },
        ],
      },
    });

    expect(parsed.data.entries[0].stages[0].source).toBe("pipeline-health");
  });
});

describe("topicMigrationRequestSchema", () => {
  it("accepts owner tribe migrations", () => {
    expect(
      topicMigrationRequestSchema.parse({
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
      }),
    ).toEqual({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      serviceType: "tribe",
    });
  });
});

describe("pipelineFeedbackActionRequestSchema", () => {
  it("accepts false-positive feedback for decision signals", () => {
    expect(
      pipelineFeedbackActionRequestSchema.parse({
        action: "decision.false_positive.marked",
        environment: "test",
        targetType: "signal",
        targetId: "test:shared_service_error_spike:pakiapps:email:20260520",
        ownerTribeId: "pakiapps",
        evidenceLink: "cbde08d3-0488-4aeb-a50e-0e280bcb058e",
        reason: "Provider maintenance window already approved",
      }),
    ).toMatchObject({
      action: "decision.false_positive.marked",
      targetType: "signal",
    });
  });
});

describe("rawToSilverRun schemas", () => {
  it("accepts raw to Common Silver preview responses", () => {
    expect(
      rawToSilverRunResponseSchema.parse({
        success: true,
        data: {
          status: "preview",
          environment: "test",
          tribeId: "greenovate",
          physicalTopic: "test.tribe.greenovate.events",
          partition: { year: "2026", month: "05", day: "22" },
          startedAt: "2026-05-23T01:00:00.000Z",
          raw: {},
          bronze: {},
          commonSilver: {},
          materialization: {
            requested: true,
            targetDatabase: "materialized_platform",
            targetTable:
              "materialized_platform.common_silver_tribe_event_envelope_greenovate_test_20260522",
            externalLocation:
              "s3://api-center-curated-data/silver/common_silver/tribe_event_envelope/tribe_id=greenovate/environment=test/year=2026/month=05/day=22/",
          },
          previewQueries: {
            raw: "SELECT COUNT(*)",
            bronze: "SELECT COUNT(*)",
            commonSilver: "SELECT COUNT(*)",
            materialize: "CREATE TABLE",
          },
        },
      }).data.materialization?.requested,
    ).toBe(true);
  });

  it("requires a tribe and full partition for raw to Common Silver runs", () => {
    expect(() =>
      rawToSilverRunRequestSchema.parse({
        environment: "test",
        tribeId: "",
        year: "2026",
        month: "05",
        day: "22",
      }),
    ).toThrow();
  });
});
