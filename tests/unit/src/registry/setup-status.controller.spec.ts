import { ForbiddenException } from "@nestjs/common";
import {
  ConsumerSetupStatusController,
  OperatorProjectSetupStatusController,
} from "../../../../apps/gateway/src/domains/catalog-registry/project-overview/project-setup-status.controller";

describe("ConsumerSetupStatusController", () => {
  it("derives tenant and environment only from the authenticated principal", async () => {
    const setupStatus = { getStatus: jest.fn().mockResolvedValue({ checks: [] }) };
    const controller = new ConsumerSetupStatusController(setupStatus as never);
    const request = {
      user: { sourceServiceId: "orders", sub: "fallback", projectId: "trusted-project", environment: "test", scopes: ["payments:read"], permissions: ["payments:write"] },
      params: { projectId: "attacker-project" },
      query: { projectId: "attacker-project", environment: "live", serviceId: "attacker-service" },
      correlationId: "correlation",
    } as never;

    await controller.getStatus(request);
    expect(setupStatus.getStatus).toHaveBeenCalledWith({
      projectId: "trusted-project",
      serviceId: "orders",
      environment: "test",
      scopes: ["payments:read", "payments:write"],
    });
  });

  it("rejects tokens without authenticated tenant context", async () => {
    const controller = new ConsumerSetupStatusController({ getStatus: jest.fn() } as never);
    await expect(controller.getStatus({ user: { sub: "orders" } } as never)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("OperatorProjectSetupStatusController", () => {
  it("rejects a service registered to a different project", async () => {
    const setupStatus = { getStatus: jest.fn() };
    const registry = { get: jest.fn(() => ({ projectId: "other-project" })) };
    const controller = new OperatorProjectSetupStatusController(setupStatus as never, registry as never);
    await expect(controller.getStatus("requested-project", "orders", "test", {} as never)).rejects.toThrow("Service was not found in this project");
    expect(setupStatus.getStatus).not.toHaveBeenCalled();
  });
});
