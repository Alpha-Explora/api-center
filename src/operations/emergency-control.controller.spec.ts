import { EmergencyControlController } from "./emergency-control.controller";
import { EmergencyControlService } from "./emergency-control.service";

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
});
