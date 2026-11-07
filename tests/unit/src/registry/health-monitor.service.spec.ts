import axios from "axios";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { HealthMonitorService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/health-monitor.service";

jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock("@shared/proxy/cloud-run-auth", () => ({ getCloudRunAuthorizationHeader: jest.fn() }));

describe("HealthMonitorService", () => {
  const originalAuthEnabled = process.env.CLOUD_RUN_AUTH_ENABLED;
  const get = axios.get as jest.MockedFunction<typeof axios.get>;
  const getAuthorization = getCloudRunAuthorizationHeader as jest.MockedFunction<typeof getCloudRunAuthorizationHeader>;

  afterEach(() => {
    get.mockReset();
    getAuthorization.mockReset();
    if (originalAuthEnabled === undefined) delete process.env.CLOUD_RUN_AUTH_ENABLED;
    else process.env.CLOUD_RUN_AUTH_ENABLED = originalAuthEnabled;
  });

  function createMonitor(serviceCount = 4) {
    let activeWrites = 0;
    let maximumWrites = 0;
    const services = Object.fromEntries(Array.from({ length: serviceCount }, (_, index) => {
      const serviceId = `service-${index}`;
      return [serviceId, { serviceId, baseUrl: `https://${serviceId}.run.app`, healthCheck: "/health", status: "active" }];
    }));
    const registry = {
      getAll: jest.fn(() => services),
      setHealthStatus: jest.fn(async () => {
        activeWrites += 1;
        maximumWrites = Math.max(maximumWrites, activeWrites);
        await new Promise((resolve) => setTimeout(resolve, 2));
        activeWrites -= 1;
        return true;
      }),
      touchHealthCheck: jest.fn(),
    };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const config = { health: { checkTimeoutMs: 1000 } };
    return {
      monitor: new HealthMonitorService(registry as never, logger as never, config as never),
      registry,
      getMaximumWrites: () => maximumWrites,
    };
  }

  it("authenticates private Cloud Run health requests and leaves local requests unauthenticated", async () => {
    process.env.CLOUD_RUN_AUTH_ENABLED = "true";
    getAuthorization.mockImplementation(async (upstream) => upstream.endsWith(".run.app") ? "Bearer cloud-run-id-token" : undefined);
    get.mockImplementation(async (url) => ({ status: url.includes("private-abc") ? 403 : 200 }) as never);
    const services = {
      private: { serviceId: "private", baseUrl: "https://private-abc.run.app", healthCheck: "/health", status: "active" },
      local: { serviceId: "local", baseUrl: "http://localhost:4010", healthCheck: "/health", status: "active" },
    };
    const registry = { getAll: jest.fn(() => services), setHealthStatus: jest.fn().mockResolvedValue(false), touchHealthCheck: jest.fn() };
    const monitor = new HealthMonitorService(registry as never, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never, { health: { checkTimeoutMs: 1000 } } as never);

    await monitor.handleHealthChecks();

    expect(getAuthorization).toHaveBeenCalledWith("https://private-abc.run.app");
    expect(get).toHaveBeenCalledWith("https://private-abc.run.app/health", expect.objectContaining({ headers: { Authorization: "Bearer cloud-run-id-token" } }));
    expect(get).toHaveBeenCalledWith("http://localhost:4010/health", expect.not.objectContaining({ headers: expect.anything() }));
    expect(registry.setHealthStatus.mock.calls).toEqual([
      ["private", true],
      ["local", true],
    ]);
  });

  it("limits health requests, serializes registry writes, and ignores an overlapping sweep", async () => {
    let activeRequests = 0;
    let maximumRequests = 0;
    getAuthorization.mockResolvedValue(undefined);
    get.mockImplementation(async () => {
      activeRequests += 1;
      maximumRequests = Math.max(maximumRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 4));
      activeRequests -= 1;
      return { status: 200 } as never;
    });
    const { monitor, registry, getMaximumWrites } = createMonitor(5);

    const firstSweep = monitor.handleHealthChecks();
    await monitor.handleHealthChecks();
    await firstSweep;

    expect(get).toHaveBeenCalledTimes(5);
    expect(maximumRequests).toBeLessThanOrEqual(2);
    expect(registry.setHealthStatus).toHaveBeenCalledTimes(5);
    expect(getMaximumWrites()).toBe(1);
  });

  it("does not mark a reachable upstream unhealthy when its registry update fails and recovers its queue", async () => {
    getAuthorization.mockResolvedValue(undefined);
    get.mockResolvedValue({ status: 200 } as never);
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const registry = {
      getAll: jest.fn(() => ({
        orders: { serviceId: "orders", baseUrl: "http://localhost:4010", healthCheck: "/health", status: "active" },
      })),
      setHealthStatus: jest.fn()
        .mockRejectedValueOnce(new Error("database credentials must not be logged"))
        .mockResolvedValue(false),
      touchHealthCheck: jest.fn(),
    };
    const monitor = new HealthMonitorService(registry as never, logger as never, { health: { checkTimeoutMs: 1000 } } as never);

    await monitor.handleHealthChecks();
    await monitor.handleHealthChecks();

    expect(registry.setHealthStatus.mock.calls).toEqual([
      ["orders", true],
      ["orders", true],
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to persist health-check result for 'orders'",
      "HealthMonitor",
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("database credentials"),
      expect.anything(),
    );
  });
});
