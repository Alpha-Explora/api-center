import { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import { QuotaEvaluationLedger } from "../../../../apps/gateway/src/domains/runtime-ops/quota-ledger/quota-evaluation-ledger.types";
import { TribeCostService } from "../../../../apps/gateway/src/domains/runtime-ops/costs/tribe-cost.service";
import { TribeQuotaEnforcerService } from "../../../../apps/gateway/src/domains/governance/quotas/tribe-quota-enforcer.service";
import { TribeQuotaPolicyService } from "../../../../apps/gateway/src/domains/governance/quotas/tribe-quota-policy.service";

describe("TribeQuotaEnforcerService", () => {
  let policies: {
    resolvePolicies: jest.Mock;
  };
  let ledger: { record: jest.Mock };
  let auditEvents: { record: jest.Mock };
  let service: TribeQuotaEnforcerService;

  beforeEach(() => {
    policies = {
      resolvePolicies: jest.fn(),
    };
    ledger = { record: jest.fn().mockResolvedValue(undefined) };
    auditEvents = { record: jest.fn().mockResolvedValue(undefined) };
    service = new TribeQuotaEnforcerService(
      policies as unknown as TribeQuotaPolicyService,
      ledger as unknown as QuotaEvaluationLedger,
      {
        redis: { rateLimitUrl: "" },
      } as ConfigService,
      new TribeCostService(),
      auditEvents as unknown as AuditEventsService,
    );
  });

  it("allows calls under an enforce policy", async () => {
    policies.resolvePolicies.mockResolvedValue(tribeOnly(policy({ maxRequests: 2 })));

    await expect(service.check(request())).resolves.toBeUndefined();
    await expect(service.check(request())).resolves.toBeUndefined();

    expect(ledger.record).toHaveBeenCalledTimes(2);
    expect(ledger.record).toHaveBeenLastCalledWith(expect.objectContaining({
      ownerTribeId: "campus-one",
      requestCount: 2,
      maxRequests: 2,
      mode: "enforce",
      outcome: "allowed",
      environment: "test",
    }));
    expect(auditEvents.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "quota.evaluation.allowed",
        actionFamily: "quota",
        actor: "campus-one",
        resourceType: "quota_evaluation",
        resourceId: "corr-123",
        environment: "test",
        correlationId: "corr-123",
        severity: "info",
        message: "Quota evaluation allowed for campus-one",
        payload: expect.objectContaining({
          ownerTribeId: "campus-one",
          policyId: "policy-payment",
          scope: "shared",
          targetServiceId: "payment-service",
          routeFamily: "shared-service",
          requestCount: 2,
          maxRequests: 2,
          mode: "enforce",
          outcome: "allowed",
          actionOutcome: "allowed",
          correlationId: "corr-123",
          environment: "test",
        }),
      }),
    );
  });

  it("records observed_exceeded without blocking when policy mode is observe", async () => {
    policies.resolvePolicies.mockResolvedValue(
      tribeOnly(policy({ mode: "observe", maxRequests: 1 })),
    );

    await service.check(request());
    await expect(service.check(request())).resolves.toBeUndefined();

    expect(ledger.record).toHaveBeenLastCalledWith(expect.objectContaining({
      requestCount: 2,
      maxRequests: 1,
      mode: "observe",
      outcome: "observed_exceeded",
    }));
  });

  it("throws QuotaExceededError when an enforce policy is exceeded", async () => {
    policies.resolvePolicies.mockResolvedValue(tribeOnly(policy({ maxRequests: 1 })));

    await service.check(request());
    await expect(service.check(request())).rejects.toMatchObject({
      status: 429,
      code: "TRIBE_API_QUOTA_EXCEEDED",
      detail: expect.objectContaining({
        ownerTribeId: "campus-one",
        level: "tribe",
        retryAfterSeconds: expect.any(Number),
        quota: {
          maxRequests: 1,
          windowSeconds: 60,
          scope: "shared",
          targetServiceId: "payment-service",
        },
      }),
    });
    expect(auditEvents.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "quota.evaluation.denied",
        actionFamily: "quota",
        actor: "campus-one",
        resourceType: "quota_evaluation",
        resourceId: "corr-123",
        environment: "test",
        correlationId: "corr-123",
        severity: "warning",
        message: "Quota evaluation denied for campus-one",
        payload: expect.objectContaining({
          outcome: "blocked",
          actionOutcome: "denied",
          requestCount: 2,
          maxRequests: 1,
        }),
      }),
    );
  });

  it("falls back to memory counters when Redis is not writeable", async () => {
    policies.resolvePolicies.mockResolvedValue(tribeOnly(policy({ maxRequests: 1 })));
    (service as unknown as { getRedis: jest.Mock }).getRedis = jest
      .fn()
      .mockResolvedValue({
        incr: jest.fn().mockRejectedValue(new Error("Stream isn't writeable")),
      });

    await service.check(request());
    await expect(service.check(request())).rejects.toMatchObject({
      status: 429,
      code: "TRIBE_API_QUOTA_EXCEEDED",
    });
  });

  it("does nothing when no policy is active", async () => {
    policies.resolvePolicies.mockResolvedValue({ project: null, tribe: null });

    await expect(service.check(request())).resolves.toBeUndefined();

    expect(ledger.record).not.toHaveBeenCalled();
  });

  it("counts a call against both the project budget and the tribe ceiling", async () => {
    policies.resolvePolicies.mockResolvedValue({
      project: policy({ id: "lms-budget", projectId: "campus-lms", maxRequests: 5 }),
      tribe: policy({ id: "tribe-ceiling", projectId: null, maxRequests: 100 }),
    });

    await service.check({ ...request(), projectId: "campus-lms" });

    expect(ledger.record).toHaveBeenCalledTimes(2);
    const policyIds = ledger.record.mock.calls.map(
      ([entry]: [{ policyId: string; projectId: string }]) => [entry.policyId, entry.projectId],
    );
    expect(policyIds).toEqual([
      ["lms-budget", "campus-lms"],
      ["tribe-ceiling", "campus-lms"],
    ]);
  });

  it("blocks on an exhausted project budget while the tribe ceiling still has room", async () => {
    policies.resolvePolicies.mockResolvedValue({
      project: policy({ id: "lms-budget", projectId: "campus-lms", maxRequests: 1 }),
      tribe: policy({ id: "tribe-ceiling", projectId: null, maxRequests: 100 }),
    });

    await service.check({ ...request(), projectId: "campus-lms" });
    await expect(service.check({ ...request(), projectId: "campus-lms" })).rejects.toMatchObject({
      status: 429,
      detail: expect.objectContaining({ level: "project", projectId: "campus-lms" }),
    });
    expect(ledger.record).toHaveBeenLastCalledWith(expect.objectContaining({ policyId: "lms-budget", outcome: "blocked", requestCount: 2 }));
  });

  it("does not count a project-blocked call against the shared tribe ceiling", async () => {
    policies.resolvePolicies.mockResolvedValue({
      project: policy({ id: "lms-budget", projectId: "campus-lms", maxRequests: 1 }),
      tribe: policy({ id: "tribe-ceiling", projectId: null, maxRequests: 100 }),
    });

    await service.check({ ...request(), projectId: "campus-lms" });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(service.check({ ...request(), projectId: "campus-lms" })).rejects.toMatchObject({
        status: 429,
      });
    }

    const ceilingCounts = ledger.record.mock.calls
      .map(([entry]: [{ policyId: string; requestCount: number }]) => entry)
      .filter((data: { policyId: string }) => data.policyId === "tribe-ceiling");
    expect(ceilingCounts).toHaveLength(1);
    expect(ceilingCounts[0].requestCount).toBe(1);
  });
  it("keeps separate counters per project under one tribe ceiling", async () => {
    policies.resolvePolicies.mockImplementation(async (input: { projectId?: string }) => ({
      project: policy({ id: `${input.projectId}-budget`, projectId: input.projectId, maxRequests: 1 }),
      tribe: policy({ id: "tribe-ceiling", projectId: null, maxRequests: 100 }),
    }));

    await service.check({ ...request(), projectId: "campus-lms" });
    await expect(service.check({ ...request(), projectId: "campus-billing" })).resolves.toBeUndefined();
  });

  it("estimates chargeback when usage is above 80 percent of quota", () => {
    expect(
      service.estimateUsageChargeback({
        requestCount: 90,
        maxRequests: 100,
        scope: "shared",
      }),
    ).toEqual({
      apiCallCost: 0.05,
      kafkaPublishCost: 0,
      analyticsScanCost: 0,
      totalCost: 0.05,
    });
  });
});

function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: "policy-payment",
    ownerTribeId: "campus-one",
    scope: "shared",
    targetServiceId: "payment-service",
    windowSeconds: 60,
    maxRequests: 100,
    burstRequests: null,
    mode: "enforce",
    status: "active",
    reason: "payment-service protection",
    ...overrides,
  };
}

function tribeOnly(tribe: ReturnType<typeof policy>) {
  return { project: null, tribe };
}

function request() {
  return {
    ownerTribeId: "campus-one",
    scope: "shared" as const,
    targetServiceId: "payment-service",
    routeFamily: "shared-service",
    correlationId: "corr-123",
    environment: "test",
  };
}
