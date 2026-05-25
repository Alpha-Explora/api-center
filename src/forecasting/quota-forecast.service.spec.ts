import { QuotaForecastService } from "./quota-forecast.service";

describe("QuotaForecastService", () => {
  it("predicts days until quota exhaustion", () => {
    const service = new QuotaForecastService();

    expect(
      service.forecast({
        quotaLimit: 10000,
        used: 7000,
        averageDailyUsage: 1000,
      }),
    ).toEqual({
      status: "warning",
      daysUntilExhaustion: 3,
      projectedMonthlyUsage: 30000,
    });
  });
});
