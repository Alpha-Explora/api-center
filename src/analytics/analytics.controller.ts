import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { RegistryService } from "../registry/registry.service";
import { AuditEventsService } from "./audit-events.service";
import { GatewayTrafficService } from "./gateway-traffic.service";
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
  constructor(
    private readonly usage: SharedServiceUsageService,
    private readonly gatewayTraffic: GatewayTrafficService,
    private readonly auditEvents: AuditEventsService,
    private readonly registry: RegistryService,
  ) {}

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

  @Get("gateway-traffic")
  async getGatewayTraffic(
    @Query("window") window: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const selectedWindow = this.parseWindow(window);
    const data = await this.gatewayTraffic.getSummary(selectedWindow);

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

  @Get("provider-usage")
  async getProviderUsage(
    @Query("window") window: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const selectedWindow = this.parseWindow(window);
    const usage = await this.usage.listUsage(selectedWindow);
    const grouped = new Map<
      string,
      {
        sharedServiceId: string;
        provider: string;
        totalRequests: number;
        failedRequests: number;
        avgLatencyMs: number;
        tribes: Set<string>;
        lastUsedAt?: string;
      }
    >();

    for (const row of usage) {
      const current = grouped.get(row.sharedServiceId) ?? {
        sharedServiceId: row.sharedServiceId,
        provider: this.providerLabel(row.sharedServiceId),
        totalRequests: 0,
        failedRequests: 0,
        avgLatencyMs: 0,
        tribes: new Set<string>(),
      };
      const previousLatencyTotal = current.avgLatencyMs * current.totalRequests;
      current.totalRequests += row.totalRequests;
      current.failedRequests += row.failedRequests;
      current.avgLatencyMs =
        current.totalRequests > 0
          ? Math.round(
              (previousLatencyTotal + row.avgLatencyMs * row.totalRequests) /
                current.totalRequests,
            )
          : 0;
      current.tribes.add(row.tribeServiceId);
      if (
        row.lastUsedAt &&
        (!current.lastUsedAt || row.lastUsedAt > current.lastUsedAt)
      ) {
        current.lastUsedAt = row.lastUsedAt;
      }
      grouped.set(row.sharedServiceId, current);
    }

    return {
      success: true,
      data: [...grouped.values()].map((row) => ({
        ...row,
        tribeCount: row.tribes.size,
        errorRate:
          row.totalRequests > 0 ? row.failedRequests / row.totalRequests : 0,
        tribes: [...row.tribes].sort(),
      })),
      meta: {
        window: selectedWindow,
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }

  @Get("alerts")
  async getAlerts(
    @Query("window") window: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const selectedWindow = this.parseWindow(window);
    const [usage, gateway] = await Promise.all([
      this.usage.listUsage(selectedWindow),
      this.gatewayTraffic.getSummary(selectedWindow),
    ]);
    const registryEntries = Object.values(this.registry.getAll());
    const alerts = [];

    for (const row of usage) {
      if (row.errorRate > 0.05) {
        alerts.push({
          id: `shared-error-rate:${row.tribeServiceId}:${row.sharedServiceId}`,
          severity: "warning",
          type: "shared-service-error-rate",
          serviceId: row.sharedServiceId,
          message: `${row.sharedServiceId} has ${(row.errorRate * 100).toFixed(1)}% errors for ${row.tribeServiceId}`,
          firstSeenAt: row.lastUsedAt,
          lastSeenAt: row.lastUsedAt,
          recommendation:
            "Check shared-service runtime logs and provider health.",
        });
      }

      const tribe = this.registry.get(row.tribeServiceId);
      if (tribe && !tribe.consumes.includes(row.sharedServiceId)) {
        alerts.push({
          id: `undeclared-use:${row.tribeServiceId}:${row.sharedServiceId}`,
          severity: "error",
          type: "undeclared-shared-service-usage",
          serviceId: row.sharedServiceId,
          message: `${row.tribeServiceId} used ${row.sharedServiceId} without declaring it in consumes`,
          firstSeenAt: row.lastUsedAt,
          lastSeenAt: row.lastUsedAt,
          recommendation:
            "Update the tribe manifest or block the unexpected caller.",
        });
      }
    }

    if (gateway.kafkaPublishFailures > 0) {
      alerts.push({
        id: "kafka-publish-failures",
        severity: "error",
        type: "kafka-publish-failures",
        message: `${gateway.kafkaPublishFailures} Kafka publish failure(s) in ${selectedWindow}`,
        firstSeenAt: gateway.lastSeenAt,
        lastSeenAt: gateway.lastSeenAt,
        recommendation:
          "Check Confluent connectivity, API key scope, and producer logs.",
      });
    }

    if (gateway.readinessFailures > 0) {
      alerts.push({
        id: "readiness-failures",
        severity: "warning",
        type: "readiness-failures",
        message: `${gateway.readinessFailures} readiness failure(s) in ${selectedWindow}`,
        firstSeenAt: gateway.lastSeenAt,
        lastSeenAt: gateway.lastSeenAt,
        recommendation:
          "Inspect readiness checks for Kafka, Redis, registry, and circuit breakers.",
      });
    }

    for (const service of registryEntries) {
      if ((service.serviceType ?? "tribe") === "tribe") {
        if (!service.ownerTeam || !service.contact) {
          alerts.push({
            id: `missing-owner:${service.serviceId}`,
            severity: "info",
            type: "missing-owner",
            serviceId: service.serviceId,
            message: `${service.serviceId} has no complete owner/contact metadata`,
            recommendation:
              "Update ownerTeam and contact in the service manifest.",
          });
        }
        continue;
      }

      const consumers = this.registry.getConsumers(service.serviceId);
      if (consumers.length > 0 && !service.healthCheck) {
        alerts.push({
          id: `shared-no-health:${service.serviceId}`,
          severity: "warning",
          type: "shared-service-no-health",
          serviceId: service.serviceId,
          message: `${service.serviceId} has consumers but no healthCheck path`,
          recommendation:
            "Add a healthCheck path to the shared-service manifest.",
        });
      }
    }

    return {
      success: true,
      data: alerts,
      meta: {
        window: selectedWindow,
        total: alerts.length,
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }

  @Get("audit/events")
  async getAuditEvents(
    @Query("limit") limit: string | undefined,
    @Query("serviceId") serviceId: string | undefined,
    @Query("type") type: string | undefined,
    @Query("actionFamily") actionFamily: string | undefined,
    @Query("actor") actor: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = await this.auditEvents.list({
      limit: limit ? Number(limit) : 100,
      serviceId,
      type,
      actionFamily: actionFamily as any,
      actor,
    });

    return {
      success: true,
      data,
      meta: {
        total: data.length,
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

  private providerLabel(sharedServiceId: string): string {
    const labels: Record<string, string> = {
      geo: "Google Maps",
      email: "Resend",
      sms: "SMS provider",
      payment: "PayMongo",
      paymongo: "PayMongo",
      otp: "OTP",
      gauth: "Google OAuth",
    };

    return labels[sharedServiceId] ?? sharedServiceId;
  }
}
