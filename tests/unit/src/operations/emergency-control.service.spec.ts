import {
  EmergencyControlService,
  parseEmergencyControl,
} from "../../../../apps/gateway/src/operations/emergency-control.service";
import { ValidationError } from "../../../../apps/gateway/src/shared/errors";

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

  it("trims and validates emergency control input", () => {
    expect(
      parseEmergencyControl({
        targetType: "service",
        targetId: " student-api ",
        mode: "observe_only",
        reason: " Incident review ",
        appliedBy: " platform ",
      }),
    ).toEqual({
      targetType: "service",
      targetId: "student-api",
      mode: "observe_only",
      reason: "Incident review",
      appliedBy: "platform",
    });
  });

  it("rejects empty emergency control fields", () => {
    expect(() =>
      parseEmergencyControl({
        targetType: "tribe",
        targetId: "",
        mode: "pause",
        reason: "",
        appliedBy: "",
      }),
    ).toThrow(ValidationError);
  });
});
