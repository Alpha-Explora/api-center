import { ApiDeprecationService } from "../../../../apps/gateway/src/domains/runtime-ops/deprecations/api-deprecation.service";

describe("ApiDeprecationService", () => {
  it("shows impacted consumers for deprecated products", () => {
    const service = new ApiDeprecationService();

    expect(
      service.evaluate({
        productId: "payment",
        deprecatedAt: "2026-05-01T00:00:00.000Z",
        sunsetAt: "2999-01-01T00:00:00.000Z",
        consumers: ["campus-one"],
      }),
    ).toMatchObject({
      status: "deprecated",
      impactedConsumers: ["campus-one"],
    });
  });
});
