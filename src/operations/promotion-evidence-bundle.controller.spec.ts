import { RegistryService } from "../registry/registry.service";
import { PromotionEvidenceBundleController } from "./promotion-evidence-bundle.controller";
import { PromotionEvidenceBundleService } from "./promotion-evidence-bundle.service";

describe("PromotionEvidenceBundleController", () => {
  it("returns markdown evidence when requested", () => {
    const registry = {
      get: jest.fn().mockReturnValue({
        serviceId: "campus-one",
        consumes: ["kafka"],
      }),
    } as unknown as RegistryService;
    const controller = new PromotionEvidenceBundleController(
      registry,
      new PromotionEvidenceBundleService(),
    );

    const response = controller.getEvidence("campus-one", "md");

    expect(response).toContain("# Promotion Evidence: campus-one");
    expect(response).toContain("## Health");
  });
});
