import { AuthService } from "../../../../apps/gateway/src/domains/auth-security/auth/auth.service";
import { ServiceSpecController } from "../../../../apps/gateway/src/domains/catalog-registry/catalog/service-spec.controller";
import { ServiceSpecService } from "../../../../apps/gateway/src/domains/catalog-registry/catalog/service-spec.service";
import { AuthenticatedRequest } from "../../../../apps/gateway/src/types";

describe("ServiceSpecController stable identity routing", () => {
  const serviceIdentity = "11111111-1111-4111-8111-111111111111";

  it("uses the selected service identity for every platform-admin operation", async () => {
    const specs = {
      publish: jest.fn().mockResolvedValue({ version: "1.0.0" }),
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue({ document: {} }),
    };
    const auth = {
      mergeCallerScopes: jest.fn().mockReturnValue(["platform:admin"]),
    };
    const controller = new ServiceSpecController(
      specs as unknown as ServiceSpecService,
      auth as unknown as AuthService,
    );
    const request = { user: { sub: "admin" } } as AuthenticatedRequest;
    const body = {
      version: "1.0.0",
      format: "openapi-3.1",
      document: {},
    } as const;

    await controller.publish(serviceIdentity, body, request);
    await controller.list(serviceIdentity);
    await controller.latest(serviceIdentity);
    await controller.version(serviceIdentity, "1.0.0");

    expect(specs.publish).toHaveBeenCalledWith(
      serviceIdentity,
      "admin",
      body,
      undefined,
    );
    expect(specs.list).toHaveBeenCalledWith(serviceIdentity);
    expect(specs.get).toHaveBeenNthCalledWith(1, serviceIdentity);
    expect(specs.get).toHaveBeenNthCalledWith(2, serviceIdentity, "1.0.0");
  });
});
