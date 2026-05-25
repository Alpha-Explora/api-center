import { Global, Module } from "@nestjs/common";
import { QuotaForecastService } from "./quota-forecast.service";

@Global()
@Module({
  providers: [QuotaForecastService],
  exports: [QuotaForecastService],
})
export class ForecastingModule {}
