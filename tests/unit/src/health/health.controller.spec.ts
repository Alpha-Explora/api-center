import { HealthCheckService } from "@nestjs/terminus";
import { HealthController } from "../../../../apps/gateway/src/domains/runtime-ops/health/health.controller";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";

type IndicatorFn = () => Promise<Record<string, unknown>>;

// Runs the indicators the way Terminus does and merges their results.
const health = {
  check: jest.fn(async (indicators: IndicatorFn[]) => Object.assign({}, ...(await Promise.all(indicators.map((indicator) => indicator()))))),
} as unknown as HealthCheckService;

describe("HealthController", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reports the process for liveness without touching the database", async () => {
    const prisma = { $queryRawUnsafe: jest.fn() } as unknown as PrismaService;
    process.env.DATABASE_URL = "postgres://example";
    const result = (await new HealthController(health, prisma).liveness()) as unknown as Record<string, { status: string }>;
    expect(result.process.status).toBe("up");
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("reports the database and the running release for readiness", async () => {
    process.env.DATABASE_URL = "postgres://example";
    process.env.K_REVISION = "apicenter-gateway-00042";
    process.env.APICENTER_RELEASE_SHA = "abc123";
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ "?column?": 1 }]) } as unknown as PrismaService;
    const result = (await new HealthController(health, prisma).readiness()) as unknown as Record<string, Record<string, unknown>>;
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith("SELECT 1");
    expect(result.database).toEqual({ status: "up" });
    expect(result.release).toEqual({ status: "up", imageTag: "apicenter-gateway-00042", sha: "abc123" });
  });

  it("marks the database down when it does not answer", async () => {
    process.env.DATABASE_URL = "postgres://example";
    const prisma = { $queryRawUnsafe: jest.fn().mockRejectedValue(new Error("connection refused")) } as unknown as PrismaService;
    const result = (await new HealthController(health, prisma).readiness()) as unknown as Record<string, Record<string, unknown>>;
    expect(result.database).toEqual({ status: "down" });
  });
});
