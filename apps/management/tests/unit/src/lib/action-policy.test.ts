import { describe, expect, it } from "vitest";
import { authorizeManagementAction } from "../../../../src/lib/action-policy";

describe("authorizeManagementAction", () => {
  it("allows observer read access", () => {
    expect(
      authorizeManagementAction({
        role: "observer",
        environment: "live",
        actionRisk: "read",
      }).allowed,
    ).toBe(true);
  });

  it("blocks observer writes", () => {
    expect(
      authorizeManagementAction({
        role: "observer",
        environment: "test",
        actionRisk: "state-write",
      }),
    ).toEqual({
      allowed: false,
      reason: "observer cannot perform state-write actions",
      confirmationRequired: false,
      reasonRequired: false,
    });
  });

  it("blocks live creates for operators", () => {
    expect(
      authorizeManagementAction({
        role: "operator",
        environment: "live",
        actionRisk: "state-write",
      }),
    ).toEqual({
      allowed: false,
      reason: "live write actions require admin role",
      confirmationRequired: false,
      reasonRequired: false,
    });
  });

  it("requires typed confirmation and reason for live admin writes", () => {
    expect(
      authorizeManagementAction({
        role: "admin",
        environment: "live",
        actionRisk: "state-write",
      }),
    ).toEqual({
      allowed: true,
      confirmationRequired: true,
      reasonRequired: true,
    });
  });
});
