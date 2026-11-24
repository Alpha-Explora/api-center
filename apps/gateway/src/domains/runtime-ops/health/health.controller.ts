// Liveness (the process is up) and readiness (the database answers). Readiness also reports the
// running release, so a deploy can be checked from outside.
import { databaseConfigured } from "@config/database-configured";
import { Controller, Get, Optional } from "@nestjs/common";
import { HealthCheck, HealthCheckService, HealthCheckResult, HealthIndicatorResult } from "@nestjs/terminus";
import { PrismaService } from "@database/prisma.service";

@Controller("health")
export class HealthController {
  private readonly databaseEnabled = databaseConfigured();

  constructor(
    private readonly health: HealthCheckService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /** GET /api/v1/health/live */
  @Get("live")
  @HealthCheck()
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([() => this.processCheck()]);
  }

  /** GET /api/v1/health/ready */
  @Get("ready")
  @HealthCheck()
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([() => this.processCheck(), () => this.databaseCheck(), () => this.releaseCheck()]);
  }

  private async processCheck(): Promise<HealthIndicatorResult> {
    const memory = process.memoryUsage();
    return {
      process: {
        status: "up",
        uptime: Math.floor(process.uptime()),
        memory: { rss: `${Math.round(memory.rss / 1024 / 1024)}MB`, heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB` },
      },
    };
  }

  private async databaseCheck(): Promise<HealthIndicatorResult> {
    if (!this.databaseEnabled || !this.prisma) return { database: { status: "up", mode: "disabled" } };
    try {
      await this.prisma.$queryRawUnsafe("SELECT 1");
      return { database: { status: "up" } };
    } catch {
      return { database: { status: "down" } };
    }
  }

  private async releaseCheck(): Promise<HealthIndicatorResult> {
    return {
      release: {
        status: "up",
        imageTag: process.env.K_REVISION ?? process.env.APICENTER_IMAGE_TAG ?? "local",
        sha: process.env.APICENTER_RELEASE_SHA ?? "local",
      },
    };
  }
}
