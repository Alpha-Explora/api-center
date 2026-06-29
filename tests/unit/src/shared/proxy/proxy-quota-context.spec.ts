import { checkProxyQuota } from "../../../../../src/shared/proxy/proxy-quota-context";

describe("checkProxyQuota", () => {
  it("checks quota using namespace-scoped route family", async () => {
    const quotaEnforcer = {
      check: jest.fn().mockResolvedValue(undefined),
    };

    await checkProxyQuota({
      quotaEnforcer: quotaEnforcer as any,
      ownerTribeId: "orders-tribe",
      namespace: "tribe",
      targetServiceId: "orders",
      correlationId: "corr-1",
    });

    expect(quotaEnforcer.check).toHaveBeenCalledWith({
      ownerTribeId: "orders-tribe",
      scope: "tribe",
      targetServiceId: "orders",
      routeFamily: "tribe:orders",
      correlationId: "corr-1",
    });
  });
});
