import { AuditEventsService } from "../../../../src/analytics/audit-events.service";
import { GatewayConfigPublishEvidenceService } from "../../../../src/gateway-control-plane/gateway-config-publish-evidence.service";

describe("GatewayConfigPublishEvidenceService", () => {
  it("records gateway config publish evidence without creating gateway DDL", () => {
    const auditEvents = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new GatewayConfigPublishEvidenceService(
      auditEvents as unknown as AuditEventsService,
    );

    const evidence = service.recordPublishedSnapshot({
      configVersion: "gwcfg-20260625-001",
      checksum: "sha256:abc123",
      targetEnvironment: "test",
      approvedBy: "platform-admin",
      approvalRequestId: "approval-gw-1",
      routeCount: 42,
      publishedAt: new Date("2026-06-25T12:00:00.000Z"),
    });

    expect(evidence).toEqual({
      configVersion: "gwcfg-20260625-001",
      checksum: "sha256:abc123",
      targetEnvironment: "test",
      approvedBy: "platform-admin",
      approvalRequestId: "approval-gw-1",
      routeCount: 42,
      publishedAt: "2026-06-25T12:00:00.000Z",
    });
    expect(auditEvents.record).toHaveBeenCalledWith({
      type: "gateway.config.published",
      actionFamily: "gateway",
      actor: "platform-admin",
      severity: "info",
      message: "Gateway config gwcfg-20260625-001 published for test",
      payload: evidence,
    });
  });
});
