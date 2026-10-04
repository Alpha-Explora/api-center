import { ComplianceExportController } from "../../../../apps/gateway/src/domains/compliance/compliance/compliance-export.controller";
import { ComplianceExportService } from "../../../../apps/gateway/src/domains/compliance/compliance/compliance-export.service";

describe("ComplianceExportController", () => {
  it("filters audit events by date range and includes evidence bundles", async () => {
    const auditEvents = {
      listWithSourceMetadata: jest.fn().mockResolvedValue({
        data: [
          {
            type: "quota.policy.updated",
            timestamp: "2026-05-20T00:00:00.000Z",
          },
        ],
        sourceMetadata: {
          sourceType: "durable",
          sourceName: "audit-events-postgres",
          durability: "postgres",
          evidenceTable: "apic_audit.audit_events",
        },
      }),
    };
    const evidence = {
      listBundlesWithSourceMetadata: jest.fn().mockReturnValue({
        data: [{ serviceId: "campus-one", ready: true }],
        sourceMetadata: {
          sourceType: "volatile",
          sourceName: "promotion-evidence-memory-bundles",
          durability: "none",
          degradedReason: "memory only",
        },
      }),
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

    expect(auditEvents.listWithSourceMetadata).toHaveBeenCalledWith({
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
      meta: {
        sourceMetadata: [
          expect.objectContaining({ sourceName: "audit-events-postgres" }),
          expect.objectContaining({
            sourceName: "promotion-evidence-memory-bundles",
            sourceType: "volatile",
          }),
        ],
      },
    });
  });

  it("returns markdown when requested", async () => {
    const auditEvents = {
      listWithSourceMetadata: jest.fn().mockResolvedValue({
        data: [],
        sourceMetadata: {
          sourceType: "volatile",
          sourceName: "audit-events-memory-cache",
          durability: "redis-window",
        },
      }),
    };
    const evidence = {
      listBundlesWithSourceMetadata: jest.fn().mockReturnValue({
        data: [],
        sourceMetadata: {
          sourceType: "volatile",
          sourceName: "promotion-evidence-memory-bundles",
          durability: "none",
        },
      }),
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
