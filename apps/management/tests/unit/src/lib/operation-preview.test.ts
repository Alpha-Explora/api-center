import { describe, expect, it } from "vitest";
import { createOperationPreview } from "../../../../src/lib/operation-preview";

describe("createOperationPreview", () => {
  it("summarizes one-click operation impact", () => {
    const preview = createOperationPreview({
      actionId: "shared-service.payment.rollout",
      environment: "live",
      risk: "provider-write",
      changes: ["Validate PayMongo checkout wrapper", "Validate subscription wrapper"],
    });

    expect(preview.confirmationPhrase).toBe("APPLY LIVE CHANGE");
    expect(preview.changes).toHaveLength(2);
  });
});
