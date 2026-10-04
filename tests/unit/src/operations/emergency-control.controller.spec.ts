import { EmergencyControlController } from "../../../../apps/gateway/src/domains/runtime-ops/operations/emergency-control.controller";
import { EmergencyControlService } from "../../../../apps/gateway/src/domains/runtime-ops/operations/emergency-control.service";
import { ValidationError } from "../../../../apps/gateway/src/shared/errors";

describe("EmergencyControlController", () => {
  it("applies and lists emergency controls", () => {
    const service = new EmergencyControlService();
    const controller = new EmergencyControlController(service);

    controller.apply({
      targetType: "tribe",
      targetId: "campus-one",
      mode: "pause",
      reason: "Incident",
      appliedBy: "platform",
    });

    expect(controller.list().data).toHaveLength(1);
  });

  it("rejects invalid emergency control input", () => {
    const service = new EmergencyControlService();
    const controller = new EmergencyControlController(service);

    expect(() =>
      controller.apply({
        targetType: "bad",
        targetId: "",
        mode: "pause",
        reason: "",
        appliedBy: "",
      } as never),
    ).toThrow(ValidationError);
  });
});
