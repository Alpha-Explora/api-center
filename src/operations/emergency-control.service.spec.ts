import { EmergencyControlService } from "./emergency-control.service";

describe("EmergencyControlService", () => {
  it("blocks traffic when a tribe is paused", () => {
    const service = new EmergencyControlService();

    service.apply({
      targetType: "tribe",
      targetId: "campus-one",
      mode: "pause",
      reason: "Incident containment",
      appliedBy: "platform@example.test",
    });

    expect(
      service.evaluate({
        ownerTribeId: "campus-one",
        serviceId: "student-api",
      }),
    ).toEqual({
      allowed: false,
      reason: "Incident containment",
      mode: "pause",
    });
  });
});
