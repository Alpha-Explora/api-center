import { Injectable } from "@nestjs/common";

@Injectable()
export class QuotaForecastService {
  forecast(input: {
    quotaLimit: number;
    used: number;
    averageDailyUsage: number;
  }) {
    const remaining = Math.max(0, input.quotaLimit - input.used);
    const daysUntilExhaustion =
      input.averageDailyUsage <= 0
        ? null
        : Math.ceil(remaining / input.averageDailyUsage);
    const projectedMonthlyUsage = Math.round(input.averageDailyUsage * 30);

    return {
      status:
        daysUntilExhaustion !== null && daysUntilExhaustion <= 7
          ? "warning"
          : "normal",
      daysUntilExhaustion,
      projectedMonthlyUsage,
    };
  }
}
