import { ComplianceExportController } from "./compliance-export.controller";
import { ComplianceExportService } from "./compliance-export.service";

describe("ComplianceExportController", () => {
  it("filters audit events by date range and includes evidence bundles", async () => {
    const auditEvents = {
      list: jest.fn().mockResolvedValue([
        { type: "quota.policy.updated", timestamp: "2026-05-20T00:00:00.000Z" },
      ]),
    };
    const evidence = {
      listBundles: jest
        .fn()
        .mockReturnValue([{ serviceId: "campus-one", ready: true }]),
    };
    const controller = new ComplianceExportController(
      auditEvents as any,
      new ComplianceExportService(),
      evidence as any,
    );

    const response = await controller.export(
      "2026-05-01",
      "2026-05-25",
      "json",
    );

    expect(auditEvents.list).toHaveBeenCalledWith({
      limit: 500,
      from: "2026-05-01",
      to: "2026-05-25",
    });
    expect(response).toMatchObject({
      success: true,
      data: {
        summary: {
          evidenceBundleCount: 1,
        },
      },
    });
  });

  it("returns markdown when requested", async () => {
    const auditEvents = {
      list: jest.fn().mockResolvedValue([]),
    };
    const evidence = {
      listBundles: jest.fn().mockReturnValue([]),
    };
    const response = {
      type: jest.fn(),
    };
    const controller = new ComplianceExportController(
      auditEvents as any,
      new ComplianceExportService(),
      evidence as any,
    );

    const markdown = await controller.export(
      "2026-05-01",
      "2026-05-25",
      "md",
      response as any,
    );

    expect(response.type).toHaveBeenCalledWith("text/markdown");
    expect(markdown).toContain("# APICenter Compliance Export");
  });
});
