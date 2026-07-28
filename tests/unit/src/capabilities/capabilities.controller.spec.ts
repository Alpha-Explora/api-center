import { CapabilitiesController } from "../../../../apps/gateway/src/capabilities/capabilities.controller";
import { CapabilitiesSnapshot } from "../../../../apps/gateway/src/capabilities/capabilities.service";

describe("CapabilitiesController", () => {
  it("wraps the capabilities snapshot in the standard API envelope", () => {
    const snapshot: CapabilitiesSnapshot = {
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
    };
    const controller = new CapabilitiesController({
      snapshot: () => snapshot,
    } as never);

    expect(controller.getCapabilities()).toEqual({
      success: true,
      data: snapshot,
    });
  });
});
