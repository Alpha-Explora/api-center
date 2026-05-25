import { RegistryService } from "../registry/registry.service";
import { RuntimeDependencyMapController } from "./runtime-dependency-map.controller";
import { RuntimeDependencyMapService } from "./runtime-dependency-map.service";

describe("RuntimeDependencyMapController", () => {
  it("returns a runtime dependency map from registry entries", () => {
    const registry = {
      getAll: jest.fn().mockReturnValue({
        "campus-one": {
          serviceId: "campus-one",
          serviceType: "tribe",
          consumes: ["payment-service", "kafka"],
        },
      }),
    } as unknown as RegistryService;
    const controller = new RuntimeDependencyMapController(
      registry,
      new RuntimeDependencyMapService(),
    );

    const response = controller.getMap();

    expect(response.success).toBe(true);
    expect(response.data.edges).toContainEqual({
      from: "campus-one",
      to: "payment-service",
      type: "shared-service",
    });
  });
});
