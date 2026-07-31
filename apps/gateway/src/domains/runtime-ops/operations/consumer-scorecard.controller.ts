import { Controller, Get, Optional, UseGuards } from "@nestjs/common";
import { GatewayTrafficService } from "@analytics/gateway-traffic.service";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { PrismaService } from "@database/prisma.service";
import { RegistryService } from "@registry/registry.service";
import {
  ConsumerScorecardMetric,
  ConsumerScorecardService,
} from "./consumer-scorecard.service";

interface QuotaDecisionRow {
  ownerTribeId: string;
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
      prisma as unknown as { quotaEvaluation?: QuotaDecisionDelegate }
    ).quotaEvaluation;
  }

  @Get()
  async list() {
    const latestSdkVersion =
      process.env.APICENTER_SDK_CONTRACT_VERSION ?? "1.2.1";
    const gatewayErrorRate = await this.getGatewayErrorRatePercent();
    const services = Object.values(this.registry.getAll());
    const ownerTribeIds = services.map(
      (service) => service.ownerTribeId ?? service.serviceId,
    );
    const quotaUsageByOwner = await this.getQuotaUsageByOwner(ownerTribeIds);
    const data = services.map((service) => {
      const ownerTribeId = service.ownerTribeId ?? service.serviceId;
      return this.scorecards.score({
        ownerTribeId,
        sdkVersion: readSdkVersion(service),
        latestSdkVersion,
        quotaUsagePercent: quotaUsageByOwner.get(ownerTribeId) ?? "unknown",
        errorRatePercent: gatewayErrorRate,
      });
    });

    return { success: true, data };
  }

  private async getQuotaUsageByOwner(
    ownerTribeIds: string[],
  ): Promise<Map<string, ConsumerScorecardMetric>> {
    const result = new Map<string, ConsumerScorecardMetric>();
    const uniqueOwnerIds = [...new Set(ownerTribeIds)].sort();

    for (const ownerTribeId of uniqueOwnerIds) {
      result.set(ownerTribeId, "unknown");
    }

    if (!this.quotaDecisions || uniqueOwnerIds.length === 0) {
      return result;
    }

    const rows = await this.quotaDecisions.findMany({
      where: {
        ownerTribeId: {
          in: uniqueOwnerIds,
        },
      },
      orderBy: { createdAt: "desc" },
      take: uniqueOwnerIds.length * 200,
    });

    const rowsByOwner = new Map<string, QuotaDecisionRow[]>();
    for (const row of rows) {
      rowsByOwner.set(row.ownerTribeId, [
        ...(rowsByOwner.get(row.ownerTribeId) ?? []),
        row,
      ]);
    }

    for (const [ownerTribeId, ownerRows] of rowsByOwner.entries()) {
      result.set(
        ownerTribeId,
        Math.max(
          ...ownerRows.map((row) =>
            row.maxRequests > 0
              ? Math.round((row.requestCount / row.maxRequests) * 100)
              : 0,
          ),
        ),
      );
    }

    return result;
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
