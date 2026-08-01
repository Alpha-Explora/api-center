import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { OperationsModule } from "./operations/operations.module";
import { ForecastingModule } from "./forecasting/forecasting.module";
import { CapabilitiesModule } from "./capabilities/capabilities.module";

@Module({
  imports: [
    HealthModule,
    AnalyticsModule,
    OperationsModule,
    ForecastingModule,
    CapabilitiesModule,
  ],
  exports: [
    HealthModule,
    AnalyticsModule,
    OperationsModule,
    ForecastingModule,
    CapabilitiesModule,
  ],
})
export class RuntimeOpsModule {}
