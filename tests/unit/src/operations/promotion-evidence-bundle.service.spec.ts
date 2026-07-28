import { PromotionEvidenceBundleService } from "../../../../apps/gateway/src/operations/promotion-evidence-bundle.service";

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

  it("fails closed when required evidence is missing", () => {
    const service = new PromotionEvidenceBundleService();

    const bundle = service.build({
      serviceId: "campus-one",
      health: { status: "up" },
      quotaPolicy: null,
      planAssignment: null,
      approval: null,
      smoke: { status: "missing" },
      manifest: { status: "missing" },
      pipeline: null,
    });

    expect(bundle.ready).toBe(false);
    expect(bundle.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "quota", status: "fail" }),
        expect.objectContaining({ key: "plan", status: "fail" }),
        expect.objectContaining({ key: "approval", status: "fail" }),
        expect.objectContaining({ key: "smoke", status: "fail" }),
        expect.objectContaining({ key: "manifest", status: "fail" }),
        expect.objectContaining({ key: "pipeline", status: "fail" }),
      ]),
    );
  });

  it("includes source and target environment for live promotion evidence", () => {
    const service = new PromotionEvidenceBundleService();

    const bundle = service.build({
      serviceId: "campus-one",
      sourceEnvironment: "test",
      targetEnvironment: "live",
      health: { status: "up" },
      quotaPolicy: { id: "quota-1", mode: "observe" },
      planAssignment: { id: "plan-1", planKey: "standard" },
      approval: { id: "approval-1", status: "approved" },
      smoke: { status: "passed" },
      manifest: { status: "valid" },
      pipeline: { topicExists: true, s3SinkIncludesTopic: true },
    });

    expect(bundle).toEqual(
      expect.objectContaining({
        serviceId: "campus-one",
        sourceEnvironment: "test",
        targetEnvironment: "live",
      }),
    );
  });
});
