import { ComplianceExportService } from "./compliance-export.service";

describe("ComplianceExportService", () => {
  it("creates a compliance packet from audit and evidence inputs", () => {
    const service = new ComplianceExportService();

    const packet = service.buildPacket({
      from: "2026-05-01",
      to: "2026-05-25",
      auditEvents: [
        { type: "quota.policy.updated", timestamp: "2026-05-20T00:00:00.000Z" },
      ],
      evidenceBundles: [{ serviceId: "campus-one", ready: true }],
    } as any);

    expect(packet.summary.auditEventCount).toBe(1);
    expect(packet.summary.evidenceBundleCount).toBe(1);
  });
});
