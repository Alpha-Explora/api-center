import { describe, expect, it } from "vitest";
import { getManagementActionAvailability } from "../../../../src/lib/action-capabilities";

describe("getManagementActionAvailability", () => {
  it("allows observers to read but blocks writes", () => {
    const availability = getManagementActionAvailability({
      role: "observer",
      environment: "test",
    });

    expect(availability.find((item) => item.actionId === "registry.read")).toMatchObject({
      allowed: true,
    });
    expect(availability.find((item) => item.actionId === "registry.write")).toMatchObject({
      allowed: false,
      blockedReason: "observer cannot perform state-write actions",
    });
  });

  it("blocks live writes for operators", () => {
    const availability = getManagementActionAvailability({
      role: "operator",
      environment: "live",
    });

    expect(
      availability.find((item) => item.actionId === "confluent.topic.provision"),
    ).toMatchObject({
      allowed: false,
      blockedReason: "live write actions require admin role",
    });
  });

  it("requires confirmation and reason for live admin writes", () => {
    const availability = getManagementActionAvailability({
      role: "admin",
      environment: "live",
    });

    expect(
      availability.find((item) => item.actionId === "confluent.topic.provision"),
    ).toMatchObject({
      allowed: true,
      confirmationRequired: true,
      reasonRequired: true,
    });
  });
});
