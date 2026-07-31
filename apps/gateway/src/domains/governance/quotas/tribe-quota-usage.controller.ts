import {
  Controller,
  Get,
  Optional,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { TribeCostService } from "@costs/tribe-cost.service";
import { PrismaService } from "@database/prisma.service";
import { QuotaForecastService } from "@forecasting/quota-forecast.service";
import { ValidationError } from "@shared/errors";
import { AuthenticatedRequest } from "../../../types";

type UsageWindow = "1h" | "24h" | "7d" | "30d";
const USAGE_WINDOWS: UsageWindow[] = ["1h", "24h", "7d", "30d"];

interface QuotaDecisionRow {
  id: string;
  ownerTribeId: string;
  policyId?: string | null;
  scope: string;
  targetServiceId?: string | null;
  routeFamily: string;
  windowStart: Date | string;
  windowEnd: Date | string;
  requestCount: number;
  maxRequests: number;
  mode: string;
  outcome: string;
  correlationId?: string | null;
  createdAt: Date | string;
}

interface QuotaDecisionDelegate {
  findMany(args: Record<string, unknown>): Promise<QuotaDecisionRow[]>;
}

@Controller("quotas/usage")
@UseGuards(ScopedAdminGuard)
export class TribeQuotaUsageController {
  private readonly decisions: QuotaDecisionDelegate;

  constructor(
    prisma: PrismaService,
    @Optional() private readonly costs?: TribeCostService,
    @Optional() private readonly forecasts?: QuotaForecastService,
  ) {
    this.decisions = (
      prisma as unknown as { quotaEvaluation: QuotaDecisionDelegate }
    ).quotaEvaluation;
  }

  @Get()
  async getUsage(
    @Query("ownerTribeId") ownerTribeId: string | undefined,
    @Query("window") window: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const selectedWindow = this.parseWindow(window);
    const rows = await this.decisions.findMany({
      where: {
        ...(ownerTribeId ? { ownerTribeId } : {}),
        createdAt: { gte: this.windowStart(selectedWindow) },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return {
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        ownerTribeId: row.ownerTribeId,
        policyId: row.policyId ?? null,
        scope: row.scope,
        targetServiceId: row.targetServiceId ?? null,
        routeFamily: row.routeFamily,
        windowStart: this.toIso(row.windowStart),
        windowEnd: this.toIso(row.windowEnd),
        requestCount: row.requestCount,
        maxRequests: row.maxRequests,
        mode: row.mode,
        outcome: row.outcome,
        estimatedChargeback: this.estimatedChargeback(row),
        forecast: this.forecast(row),
        correlationId: row.correlationId ?? null,
        createdAt: this.toIso(row.createdAt),
      })),
      meta: {
        total: rows.length,
        window: selectedWindow,
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }

  private parseWindow(window: string | undefined): UsageWindow {
    const selectedWindow = (window ?? "24h") as UsageWindow;
    if (!USAGE_WINDOWS.includes(selectedWindow)) {
      throw new ValidationError(
        `window must be one of: ${USAGE_WINDOWS.join(", ")}`,
      );
    }
    return selectedWindow;
  }

  private windowStart(window: UsageWindow): Date {
    const hours =
      window === "1h" ? 1 : window === "24h" ? 24 : window === "7d" ? 168 : 720;
    return new Date(Date.now() - hours * 60 * 60 * 1000);
  }

  private toIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
  }

  private estimatedChargeback(row: QuotaDecisionRow) {
    if (!this.costs || row.maxRequests <= 0) return undefined;
    if (row.requestCount / row.maxRequests < 0.8) return undefined;

    return this.costs.estimateMonthlyChargeback({
      apiCalls: row.scope === "kafka_publish" ? 0 : row.requestCount,
      kafkaPublishes: row.scope === "kafka_publish" ? row.requestCount : 0,
      gbScanned: 0,
    });
  }

  private forecast(row: QuotaDecisionRow) {
    if (!this.forecasts) return undefined;

    return this.forecasts.forecast({
      quotaLimit: row.maxRequests,
      used: row.requestCount,
      averageDailyUsage: row.requestCount,
    });
  }
}
