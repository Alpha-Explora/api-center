import { RegistryService } from "../../../../apps/gateway/src/registry/registry.service";
import { ApiProductController } from "../../../../apps/gateway/src/catalog/api-product.controller";
import { ApiProductService } from "../../../../apps/gateway/src/catalog/api-product.service";

describe("ApiProductController", () => {
  it("returns projected marketplace products", () => {
    const registry = {
      getAll: jest.fn().mockReturnValue({
        payment: {
          serviceId: "payment",
          name: "Payment",
          serviceType: "shared",
          requiredScopes: ["payments:create"],
          exposes: ["/payments"],
          status: "active",
        },
      }),
    } as unknown as RegistryService;
    const controller = new ApiProductController(
      registry,
      new ApiProductService(),
    );

    expect(controller.listProducts().data[0]).toMatchObject({
      productId: "payment",
      onboardingStatus: "available",
    });
  });
});
