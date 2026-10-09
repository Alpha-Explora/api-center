import { HealthCheckService } from "@nestjs/terminus";
import { HealthController } from "../../../../apps/gateway/src/domains/runtime-ops/health/health.controller";
import { RegistryService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registry.service";
import { ExternalService } from "../../../../apps/gateway/src/domains/gateway-proxy/external/external.service";
import { TokenStoreService } from "../../../../apps/gateway/src/domains/auth-security/auth/token-store.service";
import { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { GatewayTrafficService } from "../../../../apps/gateway/src/domains/runtime-ops/analytics/gateway-traffic.service";
import { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import { GovernanceReadinessService } from "../../../../apps/gateway/src/domains/runtime-ops/health/governance-readiness.service";

type IndicatorFn = () => Promise<Record<string, unknown>>;

function createHealthCheckServiceMock(): HealthCheckService {
  return {
    check: jest.fn(async (indicators: IndicatorFn[]) => {
      const results = await Promise.all(
        indicators.map((indicator) => indicator()),
      );
      const info = Object.assign({}, ...results);

      return {
        status: "ok",
        info,
        error: {},
        details: info,
      };
    }),
  } as unknown as HealthCheckService;
}

describe("HealthController", () => {
  let controller: HealthController;
  let tokenStore: TokenStoreService;
  let externalService: ExternalService;
  let registry: RegistryService;

  beforeEach(() => {
    const health = createHealthCheckServiceMock();
    registry = {
      count: jest.fn().mockReturnValue(2),
    } as unknown as RegistryService;
    externalService = {
      getAllBreakerStats: jest.fn().mockReturnValue([]),
    } as unknown as ExternalService;
    tokenStore = {
      isRedisConnected: jest.fn().mockReturnValue(true),
    } as unknown as TokenStoreService;
    const gatewayTraffic = {
      recordReadinessFailure: jest.fn().mockResolvedValue(undefined),
    } as unknown as GatewayTrafficService;
    const auditEvents = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditEventsService;
    const governanceReadiness = new GovernanceReadinessService();
    const config = {} as ConfigService;

    controller = new HealthController(
      health,
      registry,
      externalService,
      tokenStore,
      gatewayTraffic,
      auditEvents,
      governanceReadiness,
      config,
    );
  });

  it("should expose process liveness as up", async () => {
    const result = await controller.liveness();

    expect((result as any).info.process.status).toBe("up");
  });

  it("should report redis as down when token store is disconnected", async () => {
    (tokenStore.isRedisConnected as jest.Mock).mockReturnValue(false);

    const result = await controller.readiness();

    expect((result as any).info.redis.status).toBe("down");
  });

  it("should report circuit breakers as down when at least one breaker is open", async () => {
    (externalService.getAllBreakerStats as jest.Mock).mockReturnValue([
      { name: "geo", state: "OPEN", failureCount: 3 },
    ]);

    const result = await controller.readiness();

    expect((result as any).info.circuitBreakers.status).toBe("down");
  });

  it("should include the registered services count in readiness output", async () => {
    const result = await controller.readiness();

    expect((result as any).info.registry.registeredServices).toBe(2);
  });

  it("should include governance readiness in readiness output", async () => {
    const result = await controller.readiness();

    expect((result as any).info.governance).toMatchObject({
      status: "up",
      quotaEnforcer: "up",
      policyEngine: "up",
      approvals: "up",
    });
  });

});
