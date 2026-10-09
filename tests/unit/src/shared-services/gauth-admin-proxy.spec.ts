import { SharedServicesController } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/shared-services.controller";

describe("public shared-service proxy GAuth admin rejection", () => {
  it("rejects admin paths and strips caller-supplied APICenter identity headers first", async () => {
    const controller = Object.create(
      SharedServicesController.prototype,
    ) as SharedServicesController;
    const request = {
      path: "/api/v1/shared/gauth/admin/oauth-apps/project-a/test",
      headers: {
        "x-apicenter-project-id": "attacker-project",
        "X-APICenter-Gauth-Admin-Token": "attacker-token",
        authorization: "Bearer caller-token",
      },
    };

    await expect(
      controller.proxy("gauth", request as never, {} as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(request.headers).not.toHaveProperty("x-apicenter-project-id");
    expect(request.headers).not.toHaveProperty("X-APICenter-Gauth-Admin-Token");
    expect(request.headers.authorization).toBe("Bearer caller-token");
  });
});
