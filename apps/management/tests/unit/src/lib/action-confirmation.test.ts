import { describe, expect, it } from "vitest";
import { validateActionConfirmation } from "../../../../src/lib/action-confirmation";

describe("validateActionConfirmation", () => {
  it("accepts exact typed confirmation and reason for live writes", () => {
    expect(
      validateActionConfirmation({
        confirmationRequired: true,
        reasonRequired: true,
        expectedPhrase: "APPLY LIVE CHANGE",
        typedPhrase: "APPLY LIVE CHANGE",
        reason: "Rotate stale shared-service config before rollout.",
      }),
    ).toEqual({ valid: true });
  });

  it("rejects incorrect typed confirmation", () => {
    expect(
      validateActionConfirmation({
        confirmationRequired: true,
        reasonRequired: true,
        expectedPhrase: "APPLY LIVE CHANGE",
        typedPhrase: "apply live change",
        reason: "Testing case mismatch.",
      }),
    ).toEqual({
      valid: false,
      error: "Type APPLY LIVE CHANGE exactly to continue",
    });
  });

  it("rejects blank reasons when reason is required", () => {
    expect(
      validateActionConfirmation({
        confirmationRequired: true,
        reasonRequired: true,
        expectedPhrase: "APPLY LIVE CHANGE",
        typedPhrase: "APPLY LIVE CHANGE",
        reason: " ",
      }).valid,
    ).toBe(false);
  });
});
