import {
  EmergencyControlService,
  parseEmergencyControl,
} from "../../../../apps/gateway/src/domains/runtime-ops/operations/emergency-control.service";
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

  it("stops every call made by services of a paused project, and only that project", () => {
    const controls = new EmergencyControlService();
    controls.apply({
      targetType: "project",
      targetId: "campus-lms",
      mode: "pause",
      reason: "LMS incident",
      appliedBy: "platform",
    });

    expect(
      controls.evaluate({ ownerTribeId: "campus-one", projectId: "campus-lms", sourceServiceId: "lms-api", serviceId: "grades" }),
    ).toEqual({ allowed: false, reason: "LMS incident", mode: "pause" });
    expect(
      controls.evaluate({ ownerTribeId: "campus-one", projectId: "campus-billing", sourceServiceId: "billing-api", serviceId: "grades" }),
    ).toEqual({ allowed: true });
  });
});
