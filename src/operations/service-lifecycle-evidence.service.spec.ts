import { ServiceLifecycleEvidenceService } from "./service-lifecycle-evidence.service";

describe("ServiceLifecycleEvidenceService", () => {
  const service = new ServiceLifecycleEvidenceService();

  it("builds source-backed lifecycle stages from registry, quota, plan, approval, and pipeline evidence", () => {
    const result = service.build({
      services: [
        {
          serviceId: "student-api",
          name: "Student API",
          baseUrl: "https://students.example.test",
          requiredScopes: ["students:read", "external:kafka:write"],
          exposes: ["/students"],
          consumes: ["payment-service", "kafka"],
          ownerTribeId: "campus-one",
          serviceType: "tribe",
          healthCheck: "/health",
          version: "1.0.0",
          ownerTeam: "Campus",
          contact: "campus@example.test",
          registeredAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-14T00:00:00.000Z",
          status: "active",
          healthy: true,
          lastHealthCheckAt: "2026-06-14T01:00:00.000Z",
        },
        {
          serviceId: "payment-service",
          name: "Payment Service",
          baseUrl: "https://payments.example.test",
          requiredScopes: ["payments:write"],
          exposes: ["/payments"],
          consumes: [],
          serviceType: "shared",
          healthCheck: "/health",
          version: "1.0.0",
          ownerTeam: "Payments",
          contact: "payments@example.test",
          registeredAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-14T00:00:00.000Z",
          status: "active",
          healthy: true,
        },
      ],
      quotaPolicies: [
        {
          id: "quota-1",
          ownerTribeId: "campus-one",
          status: "active",
          mode: "observe",
        },
      ],
      planAssignments: [
        {
          id: "plan-1",
          ownerTribeId: "campus-one",
          status: "active",
          environment: "prod",
        },
      ],
      approvalRequests: [
        {
          id: "approval-1",
          status: "approved",
          targetId: "student-api",
          actionType: "promotion.live",
        },
      ],
      pipelineRows: [
        {
          tribeId: "campus-one",
          sourceServiceId: "student-api",
          latestS3ObjectAt: "2026-06-14T02:00:00.000Z",
        },
      ],
    } as any);

    const entry = result.entries.find(
      (item) => item.service.serviceId === "student-api",
    );

    expect(entry?.status).toBe("ready");
    expect(entry?.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "quotas",
          status: "complete",
          source: "quota-policy",
        }),
        expect.objectContaining({
          id: "pipeline",
          status: "complete",
          source: "pipeline-health",
        }),
        expect.objectContaining({
          id: "promotion",
          status: "complete",
          source: "approval-request",
        }),
      ]),
    );
  });

  it("fails closed when owner, dependency, runtime, quota, and pipeline evidence are missing", () => {
    const result = service.build({
      services: [
        {
          serviceId: "student-api",
          name: "Student API",
          baseUrl: "https://students.example.test",
          requiredScopes: ["external:kafka:write"],
          exposes: ["/students"],
          consumes: ["missing-service"],
          serviceType: "tribe",
          version: "1.0.0",
          registeredAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-14T00:00:00.000Z",
          status: "active",
          healthy: false,
        },
      ],
      quotaPolicies: [],
      planAssignments: [],
      approvalRequests: [],
      pipelineRows: [],
    } as any);

    expect(result.summary.blocked).toBe(1);
    expect(result.entries[0]).toMatchObject({
      status: "blocked",
      blockedCount: 5,
      nextAction: {
        stageId: "ownership",
      },
    });
  });
});
