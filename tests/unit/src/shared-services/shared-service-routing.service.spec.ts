import { SharedServiceRoutingService } from "../../../../apps/gateway/src/shared-services/shared-service-routing.service";
import { ServiceUnavailableError } from "../../../../apps/gateway/src/shared/errors";

describe("SharedServiceRoutingService", () => {
  it("resolves payment test and live targets", () => {
    const service = new SharedServiceRoutingService({
      SHARED_SERVICE_ROUTE_PAYMENT_TEST: "http://payment-test:4010",
      SHARED_SERVICE_ROUTE_PAYMENT_LIVE: "http://payment-live:4010",
    } as NodeJS.ProcessEnv);

    expect(service.resolve("payment", "test").targetUrl).toBe(
      "http://payment-test:4010",
    );
    expect(service.resolve("payment", "live").targetUrl).toBe(
      "http://payment-live:4010",
    );
  });

  it("normalizes shared service ids when building route variable names", () => {
    const service = new SharedServiceRoutingService({
      SHARED_SERVICE_ROUTE_GOOGLE_AUTH_TEST: "http://gauth:4013",
    } as NodeJS.ProcessEnv);

    expect(service.resolve("google-auth", "test")).toEqual({
      sharedServiceId: "google-auth",
      environment: "test",
      targetUrl: "http://gauth:4013",
    });
  });

  it("throws when a live payment route is missing", () => {
    const service = new SharedServiceRoutingService({
      SHARED_SERVICE_ROUTE_PAYMENT_TEST: "http://payment-test:4010",
    } as NodeJS.ProcessEnv);

    expect(() => service.resolve("payment", "live")).toThrow(
      new ServiceUnavailableError(
        "Missing shared-service route SHARED_SERVICE_ROUTE_PAYMENT_LIVE for payment live",
      ),
    );
  });
});