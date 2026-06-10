import { ConfigService } from "../config/config.service";
import { CapabilitiesService } from "./capabilities.service";

describe("CapabilitiesService", () => {
  it("reports core gateway enabled and data pipeline disabled", () => {
    const service = new CapabilitiesService({
      authProvider: "internal-jwt",
      dataPipeline: { enabled: false },
      kafka: { enabled: false },
      database: { registrySource: "redis" },
      registryBootstrap: { enabled: false },
    } as ConfigService);

    expect(service.snapshot()).toEqual({
      coreGateway: {
        enabled: true,
        authProvider: "internal-jwt",
        registrySource: "redis",
        registryBootstrapEnabled: false,
      },
      dataPipeline: {
        enabled: false,
      },
      kafkaPublishing: {
        enabled: false,
      },
      tribeSecrets: {
        source: "env-hash",
      },
    });
  });

  it("reports enabled pipeline and GCP tribe secret source", () => {
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    const service = new CapabilitiesService({
      authProvider: "composite",
      dataPipeline: { enabled: true },
      kafka: { enabled: true },
      database: { registrySource: "postgres" },
      registryBootstrap: { enabled: true },
    } as ConfigService);

    expect(service.snapshot()).toMatchObject({
      coreGateway: {
        authProvider: "composite",
        registrySource: "postgres",
        registryBootstrapEnabled: true,
      },
      dataPipeline: {
        enabled: true,
      },
      kafkaPublishing: {
        enabled: true,
      },
      tribeSecrets: {
        source: "gcp-secret-manager",
      },
    });

    delete process.env.TRIBE_SECRET_SOURCE;
  });
});
