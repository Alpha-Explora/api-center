import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { ComplianceExportController } from "./compliance-export.controller";
import { ComplianceExportService } from "./compliance-export.service";

@Module({
  imports: [AnalyticsModule],
  controllers: [ComplianceExportController],
  providers: [ComplianceExportService],
  exports: [ComplianceExportService],
})
export class ComplianceModule {}
