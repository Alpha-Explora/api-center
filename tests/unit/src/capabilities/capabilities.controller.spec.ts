import { CapabilitiesController } from "../../../../apps/gateway/src/domains/runtime-ops/capabilities/capabilities.controller";
import { CapabilitiesSnapshot } from "../../../../apps/gateway/src/domains/runtime-ops/capabilities/capabilities.service";

describe("CapabilitiesController", () => {
  it("wraps the capabilities snapshot in the standard API envelope", () => {
    const snapshot: CapabilitiesSnapshot = {
      coreGateway: {
        enabled: true,
        authProvider: "internal-jwt",
        registrySource: "memory",
        registryBootstrapEnabled: false,
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
