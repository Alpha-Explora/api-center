import { PATH_METADATA } from "@nestjs/common/constants";
import { SharedServicesController } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/shared-services.controller";
import { PublishedApiProxyController } from "../../../../apps/gateway/src/domains/gateway-proxy/published-apis/published-api-proxy.controller";

describe("Nest 11 route patterns", () => {
  it.each([
    [SharedServicesController, "proxy", ":capability/*path"],
    [PublishedApiProxyController, "proxy", ":apiId/*path"],
  ])("%p.%s uses named wildcard syntax", (controller, method, expectedPath) => {
    const handler = (controller.prototype as unknown as Record<string, object>)[method];
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(expectedPath);
  });
});
