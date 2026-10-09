// =============================================================================
// src/registry/health-monitor.service.ts — Active Health Checking
// =============================================================================
// Scheduled jobs that keep the registry accurate at runtime:
//
//  1. HEALTH CHECK (every 30 s)
//     For every registered service that declares a `healthCheck` path, send an
//     HTTP GET to `baseUrl + healthCheck`.  On failure, mark the service as
//     unhealthy so the proxy stops routing traffic to it.  When the service
//     recovers, mark it healthy again.  Every transition emits a
//     SERVICE_HEALTH_CHANGED Kafka event.
//
// =============================================================================

import { Injectable, OnModuleDestroy, Optional } from "@nestjs/common";
import { VaultService } from "@auth/vault.service";
import { Cron, CronExpression } from "@nestjs/schedule";
import axios from "axios";
import { RegistryService } from "./registry.service";
import { LoggerService } from "@shared/logger.service";
import { ConfigService } from "@config/config.service";

@Injectable()
export class HealthMonitorService implements OnModuleDestroy {
  /** Tracks whether a health-check sweep is already in progress. */
  private healthCheckRunning = false;

  constructor(
    private readonly registry: RegistryService,
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
    @Optional() private readonly vault?: VaultService,
  ) {}

  onModuleDestroy() {
    // Nothing to tear down — cron jobs stop with the NestJS app lifecycle.
  }

  // =========================================================================
  // CRON 1 — Active upstream health checking (every 30 seconds)
  // =========================================================================

  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleHealthChecks(): Promise<void> {
    // Guard against overlapping sweeps if a previous one is still running.
    if (this.healthCheckRunning) return;
    this.healthCheckRunning = true;

    try {
      const allServices = this.registry.getAll();
      const entries = Object.values(allServices);

      // Build a list of services that have a healthCheck endpoint defined
      const checkable = entries.filter(
        (svc) =>
          svc.healthCheck &&
          svc.status !== "retired" &&
          svc.status !== "proposed",
      );

      if (checkable.length === 0) return;

      // Fire all health checks concurrently (each has its own timeout)
      const results = await Promise.allSettled(
        checkable.map(async (svc) => {
          const url = `${svc.baseUrl}${svc.healthCheck}`;
          try {
            const response = await axios.get(url, {
              timeout: this.config.health.checkTimeoutMs,
              validateStatus: (status) => status < 500, // 2xx–4xx = alive
            });

            // Mark healthy
            const changed = await this.registry.setHealthStatus(svc.serviceId, true);
            if (changed) {
              this.logger.info(
                `Service '${svc.serviceId}' recovered — marked healthy`,
                { serviceId: svc.serviceId, url, status: response.status },
              );
            } else {
              // No state change — just touch the timestamp
              await this.registry.touchHealthCheck(svc.serviceId);
            }
          } catch (err) {
            const reason = (err as Error).message || "Unknown error";

            // Mark unhealthy
            const changed = await this.registry.setHealthStatus(svc.serviceId, false);
            if (changed) {
              this.logger.warn(
                `Service '${svc.serviceId}' is unreachable — marked unhealthy: ${reason}`,
                "HealthMonitor",
              );
            } else {
              await this.registry.touchHealthCheck(svc.serviceId);
            }
          }
        }),
      );

      // Log any unexpected promise rejections (should not happen, but belt & suspenders)
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        this.logger.warn(
          `${failures.length} health check(s) threw unexpected errors`,
          "HealthMonitor",
        );
      }
    } finally {
      this.healthCheckRunning = false;
    }
  }

  // =========================================================================
  // CRON 3 — Vault token renewal (every 30 minutes)
  // =========================================================================
  // Renews the Vault service token before it expires (AppRole tokens are
  // short-lived). This keeps the gateway authenticated to Vault without
  // requiring a restart.
  // =========================================================================

  @Cron("0 */30 * * * *")
  async handleVaultTokenRenewal(): Promise<void> {
    if (!this.vault) return;
    try {
      await this.vault.renewToken();
    } catch (err) {
      this.logger.error(
        `Vault token renewal failed: ${(err as Error).message}`,
        (err as Error).stack,
        "HealthMonitor",
      );
    }
  }
}
