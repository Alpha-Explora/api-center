import { ApiProductService } from "../../../../src/catalog/api-product.service";

describe("ApiProductService", () => {
  it("projects registry services into marketplace products", () => {
    const service = new ApiProductService();

    const products = service.fromRegistry([
      {
        serviceId: "payment-service",
        name: "Payment Service",
        serviceType: "shared",
        ownerTeam: "Platform Payments",
        contact: "payments@example.test",
        serviceTier: "gold",
        requiredScopes: ["payments:create"],
        exposes: ["/payments"],
        status: "active",
      },
    ] as any);

    expect(products[0]).toMatchObject({
      productId: "payment-service",
      displayName: "Payment Service",
      category: "shared-service",
      onboardingStatus: "available",
    });
  });
});
