import { Controller, Get, Optional, UseGuards } from "@nestjs/common";
import { GatewayTrafficService } from "../analytics/gateway-traffic.service";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { PrismaService } from "../database/prisma.service";
import { RegistryService } from "../registry/registry.service";
import {
  ConsumerScorecardMetric,
  ConsumerScorecardService,
} from "./consumer-scorecard.service";

interface QuotaDecisionRow {
  requestCount: number;
  maxRequests: number;
}

interface QuotaDecisionDelegate {
  findMany(args: Record<string, unknown>): Promise<QuotaDecisionRow[]>;
}

@Controller("admin/operations/scorecards")
@UseGuards(ScopedAdminGuard)
export class ConsumerScorecardController {
  private readonly quotaDecisions: QuotaDecisionDelegate | undefined;

  constructor(
    private readonly registry: RegistryService,
    private readonly scorecards: ConsumerScorecardService,
    prisma: PrismaService,
    @Optional() private readonly gatewayTraffic?: GatewayTrafficService,
  ) {
    this.quotaDecisions = (
      prisma as unknown as { tribeApiQuotaDecision?: QuotaDecisionDelegate }
    ).tribeApiQuotaDecision;
  }

  @Get()
  async list() {
    const latestSdkVersion =
      process.env.APICENTER_SDK_CONTRACT_VERSION ?? "1.2.1";
    const gatewayErrorRate = await this.getGatewayErrorRatePercent();
    const data = await Promise.all(
      Object.values(this.registry.getAll()).map(async (service) => {
        const ownerTribeId = service.ownerTribeId ?? service.serviceId;
        return this.scorecards.score({
          ownerTribeId,
          sdkVersion: readSdkVersion(service),
          latestSdkVersion,
          quotaUsagePercent: await this.getQuotaUsagePercent(ownerTribeId),
          errorRatePercent: gatewayErrorRate,
        });
      }),
    );

    return { success: true, data };
  }

  private async getQuotaUsagePercent(
    ownerTribeId: string,
  ): Promise<ConsumerScorecardMetric> {
    if (!this.quotaDecisions) return "unknown";

    const rows = await this.quotaDecisions.findMany({
      where: { ownerTribeId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    if (rows.length === 0) return "unknown";
    return Math.max(
      ...rows.map((row) =>
        row.maxRequests > 0
          ? Math.round((row.requestCount / row.maxRequests) * 100)
          : 0,
      ),
    );
  }

  private async getGatewayErrorRatePercent(): Promise<ConsumerScorecardMetric> {
    if (!this.gatewayTraffic) return "unknown";

    const summary = await this.gatewayTraffic.getSummary("24h");
    if (summary.totalProxyRequests === 0) return "unknown";

    return (
      ((summary.status4xx + summary.status5xx) / summary.totalProxyRequests) *
      100
    );
  }
}

function readSdkVersion(service: unknown): string {
  if (!service || typeof service !== "object") return "unknown";
  const value =
    (service as { sdkVersion?: unknown }).sdkVersion ??
    (service as { metadata?: { sdkVersion?: unknown } }).metadata?.sdkVersion;
  return typeof value === "string" && value.trim() ? value : "unknown";
}
