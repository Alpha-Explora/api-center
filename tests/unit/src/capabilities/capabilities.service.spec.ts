import { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import { CapabilitiesService } from "../../../../apps/gateway/src/domains/runtime-ops/capabilities/capabilities.service";

describe("CapabilitiesService", () => {
  it("reports gateway and registry capabilities", () => {
    const service = new CapabilitiesService({
      authProvider: "internal-jwt",
      database: { registrySource: "redis" },
      registryBootstrap: { enabled: false },
    } as unknown as ConfigService);

    expect(service.snapshot()).toEqual({
      coreGateway: {
        enabled: true,
        authProvider: "internal-jwt",
        registrySource: "redis",
        registryBootstrapEnabled: false,
      },
      tribeSecrets: {
        source: "env-hash",
      },
    });
  });

  it("reports GCP tribe secret source", () => {
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    const service = new CapabilitiesService({
      authProvider: "composite",
      database: { registrySource: "postgres" },
      registryBootstrap: { enabled: true },
    } as unknown as ConfigService);

    expect(service.snapshot()).toMatchObject({
      coreGateway: {
        authProvider: "composite",
        registrySource: "postgres",
        registryBootstrapEnabled: true,
      },
      tribeSecrets: {
        source: "gcp-secret-manager",
      },
    });

    delete process.env.TRIBE_SECRET_SOURCE;
  });
});
