import { GUARDS_METADATA } from "@nestjs/common/constants";
import { TribeCostService } from "../../../../apps/gateway/src/domains/runtime-ops/costs/tribe-cost.service";
import { QuotaEvaluationLedger } from "../../../../apps/gateway/src/domains/runtime-ops/quota-ledger/quota-evaluation-ledger.types";
import { QuotaForecastService } from "../../../../apps/gateway/src/domains/runtime-ops/forecasting/quota-forecast.service";
import { ScopedAdminGuard } from "../../../../apps/gateway/src/domains/auth-security/auth/guards/scoped-admin.guard";
import { ValidationError } from "../../../../apps/gateway/src/shared/errors";
import { TribeQuotaUsageController } from "../../../../apps/gateway/src/domains/governance/quotas/tribe-quota-usage.controller";

describe("TribeQuotaUsageController", () => {
  const ledger = { listSince: jest.fn() };

  let controller: TribeQuotaUsageController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new TribeQuotaUsageController(
      ledger as unknown as QuotaEvaluationLedger,
      new TribeCostService(),
      new QuotaForecastService(),
    );
  });

  it("requires platform admin scope to read quota usage", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      TribeQuotaUsageController,
    );

    expect(guards).toContain(ScopedAdminGuard);
  });

  it("rejects unsupported usage windows", async () => {
    await expect(
      controller.getUsage("campus-one", "13h", {
        correlationId: "corr-usage",
      } as any),
    ).rejects.toThrow(ValidationError);
  });

  it("returns safe quota decision history for a tribe", async () => {
    ledger.listSince.mockResolvedValue([
      {
        id: "decision-1",
        ownerTribeId: "campus-one",
        policyId: "policy-1",
        scope: "shared",
        targetServiceId: "payment-service",
        routeFamily: "shared:payment-service",
        windowStart: new Date("2026-05-25T00:00:00.000Z"),
        windowEnd: new Date("2026-05-25T00:01:00.000Z"),
        requestCount: 101,
        maxRequests: 100,
        mode: "observe",
        outcome: "observed_exceeded",
        correlationId: "corr-decision",
        createdAt: new Date("2026-05-25T00:00:30.000Z"),
        plaintextSecret: "never-return",
      },
    ]);

    const response = await controller.getUsage("campus-one", "24h", {
      correlationId: "corr-usage",
    } as any);

    expect(response.data[0]).toEqual({
      id: "decision-1",
      ownerTribeId: "campus-one",
      policyId: "policy-1",
      scope: "shared",
      targetServiceId: "payment-service",
      routeFamily: "shared:payment-service",
      windowStart: "2026-05-25T00:00:00.000Z",
      windowEnd: "2026-05-25T00:01:00.000Z",
      requestCount: 101,
      maxRequests: 100,
      mode: "observe",
      outcome: "observed_exceeded",
      estimatedChargeback: {
        apiCallCost: 0.05,
        kafkaPublishCost: 0,
        analyticsScanCost: 0,
        totalCost: 0.05,
      },
      forecast: {
        status: "warning",
        daysUntilExhaustion: 0,
        projectedMonthlyUsage: 3030,
      },
      correlationId: "corr-decision",
      createdAt: "2026-05-25T00:00:30.000Z",
    });
    expect(ledger.listSince).toHaveBeenCalledWith({
      ownerTribeId: "campus-one",
      since: expect.any(Date),
      limit: 200,
    });
  });
});
