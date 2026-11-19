import type { Response } from "express";
import { SharedServicesController } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/shared-services.controller";
import type { ApplicationCapabilityProxy } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/application-capability-proxy";
import type { AuthenticatedRequest } from "../../../../apps/gateway/src/types";

const KEY = `ak_test_abcdefghijklmnop_${"B".repeat(43)}`;

describe("SharedServicesController", () => {
  const forward = jest.fn().mockResolvedValue(undefined);
  const controller = new SharedServicesController({ forward } as unknown as ApplicationCapabilityProxy);
  const res = {} as Response;
  const request = (authorization: string | undefined, path = "/api/v1/shared/email/send") =>
    ({ headers: authorization ? { authorization } : {}, path }) as unknown as AuthenticatedRequest;

  beforeEach(() => forward.mockClear());

  it("forwards a call with an application key to the capability", async () => {
    const req = request(`Bearer ${KEY}`);
    await controller.proxy("Email", req, res);
    expect(forward).toHaveBeenCalledWith("email", KEY, req, res);
  });

  it("refuses calls without an application key", async () => {
    for (const authorization of [undefined, "Bearer apic_test_legacy", "Basic abc"]) {
      await expect(controller.proxy("email", request(authorization), res)).rejects.toMatchObject({ status: 401 });
    }
    expect(forward).not.toHaveBeenCalled();
  });

  it("keeps Google sign-in administration out of the capability proxy", async () => {
    for (const path of ["/api/v1/shared/gauth/admin/apps", "/api/v1/shared/gauth/%61dmin/apps"]) {
      await expect(controller.proxy("gauth", request(`Bearer ${KEY}`, path), res)).rejects.toMatchObject({ status: 403 });
    }
    expect(forward).not.toHaveBeenCalled();
  });
});
