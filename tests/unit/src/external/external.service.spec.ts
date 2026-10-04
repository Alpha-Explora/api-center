import { ExternalService } from "../../../../apps/gateway/src/domains/gateway-proxy/external/external.service";
import { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";
import { MetricsService } from "../../../../apps/gateway/src/metrics/metrics.service";
import { NotFoundError, ServiceUnavailableError } from "../../../../apps/gateway/src/shared/errors";

describe("ExternalService", () => {
  let service: ExternalService;
  const originalEnv = process.env;
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService;
  const metrics = {
    setCircuitBreakerState: jest.fn(),
  } as unknown as MetricsService;

  const createService = () =>
    new ExternalService(new ConfigService(), logger, metrics);

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
    service = createService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should throw not found when requested API is not configured", async () => {
    (service as any).apis = {};

    await expect(
      service.call("unknown-api", { method: "GET" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("should throw unavailable when API is configured but client is not initialized", async () => {
    (service as any).apis = {
      geo: {
        displayName: "Geo API",
        baseUrl: "https://geo.example.com",
        timeout: 5000,
        authType: "none",
        authHeader: "Authorization",
      },
    };

    await expect(service.call("geo", { method: "GET" })).rejects.toThrow(
      ServiceUnavailableError,
    );
  });

  it("should return breaker stats for every registered breaker", () => {
    (service as any).breakers = new Map([
      [
        "geo",
        { getStats: () => ({ name: "geo", state: "CLOSED", failureCount: 0 }) },
      ],
      [
        "risk",
        { getStats: () => ({ name: "risk", state: "OPEN", failureCount: 3 }) },
      ],
    ]);

    const stats = service.getAllBreakerStats();

    expect(stats).toHaveLength(2);
  });

  it("should not expose legacy Kafka REST in the external API catalogue", () => {
    service = createService();
    service.onModuleInit();

    expect(service.listApis().map((api) => api.name)).not.toContain("kafka");
  });
});
