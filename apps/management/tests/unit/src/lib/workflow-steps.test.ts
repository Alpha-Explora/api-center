import { describe, expect, it } from "vitest";
import { getWorkflowProgress } from "../../../../src/lib/workflow-steps";

describe("getWorkflowProgress", () => {
  it("counts complete and blocked workflow steps", () => {
    const progress = getWorkflowProgress([
      { id: "manifest", label: "Manifest", status: "complete" },
      { id: "secret", label: "Secret", status: "blocked" },
      { id: "smoke", label: "Smoke", status: "pending" },
    ]);

    expect(progress).toEqual({
      total: 3,
      complete: 1,
      blocked: 1,
      currentStepId: "secret",
    });
  });
});
