import { TribeCostService } from "./tribe-cost.service";

describe("TribeCostService", () => {
  it("calculates estimated monthly chargeback from usage units", () => {
    const service = new TribeCostService();

    expect(
      service.estimateMonthlyChargeback({
        apiCalls: 10000,
        kafkaPublishes: 2500,
        gbScanned: 12,
      }),
    ).toEqual({
      apiCallCost: 5,
      kafkaPublishCost: 1.25,
      analyticsScanCost: 0.6,
      totalCost: 6.85,
    });
  });
});
