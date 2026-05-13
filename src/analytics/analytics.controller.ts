import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import {
  SharedServiceUsageService,
  SharedServiceUsageWindow,
} from "./shared-service-usage.service";
import { ValidationError } from "../shared/errors";
import { AuthenticatedRequest } from "../types";

const USAGE_WINDOWS: SharedServiceUsageWindow[] = ["1h", "24h", "7d", "30d"];

@Controller("analytics")
@UseGuards(ScopedAdminGuard)
export class AnalyticsController {
  constructor(private readonly usage: SharedServiceUsageService) {}

  @Get("shared-service-usage")
  async getSharedServiceUsage(
    @Query("window") window: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const selectedWindow = this.parseWindow(window);
    const data = await this.usage.listUsage(selectedWindow);

    return {
      success: true,
      data,
      meta: {
        window: selectedWindow,
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }

  private parseWindow(window: string | undefined): SharedServiceUsageWindow {
    const candidate = window ?? "24h";
    if (!USAGE_WINDOWS.includes(candidate as SharedServiceUsageWindow)) {
      throw new ValidationError(
        `window must be one of: ${USAGE_WINDOWS.join(", ")}`,
      );
    }
    return candidate as SharedServiceUsageWindow;
  }
}
