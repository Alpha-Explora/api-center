import { PromotionEvidenceBundleService } from "./promotion-evidence-bundle.service";

describe("PromotionEvidenceBundleService", () => {
  it("builds a complete promotion evidence bundle", () => {
    const service = new PromotionEvidenceBundleService();

    const bundle = service.build({
      serviceId: "campus-one",
      health: { status: "up" },
      quotaPolicy: { id: "quota-1", mode: "observe" },
      planAssignment: { id: "plan-1", planKey: "standard" },
      approval: { id: "approval-1", status: "approved" },
      smoke: { status: "passed" },
      manifest: { status: "valid" },
      pipeline: { topicExists: true, s3SinkIncludesTopic: true },
    });

    expect(bundle.ready).toBe(true);
    expect(bundle.sections.map((section) => section.key)).toEqual([
      "health",
      "quota",
      "plan",
      "approval",
      "smoke",
      "manifest",
      "pipeline",
    ]);
  });
});
