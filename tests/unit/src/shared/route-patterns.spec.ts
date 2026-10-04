import { PATH_METADATA } from "@nestjs/common/constants";
import { TribesController } from "../../../../apps/gateway/src/domains/gateway-proxy/tribes/tribes.controller";
import { SharedServicesController } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/shared-services.controller";
import { ExternalController } from "../../../../apps/gateway/src/domains/gateway-proxy/external/external.controller";

describe("Nest 11 route patterns", () => {
  it.each([
    [TribesController, "proxy", ":targetServiceId/*path"],
    [SharedServicesController, "proxy", ":serviceId/*path"],
    [ExternalController, "proxyCall", ":apiName/*path"],
  ])("%s.%s uses named wildcard syntax", (controller, method, expectedPath) => {
    const routePath = Reflect.getMetadata(
      PATH_METADATA,
      controller.prototype[method as keyof typeof controller.prototype],
    );

    expect(routePath).toBe(expectedPath);
  });
});
