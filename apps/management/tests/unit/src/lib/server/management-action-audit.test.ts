import { describe, expect, it, vi } from "vitest";
import {
  createManagementActionAuditRecord,
  emitManagementActionAudit,
} from "../../../../../src/lib/server/management-action-audit";

describe("management action audit", () => {
  it("creates redacted management action audit records", () => {
    const record = createManagementActionAuditRecord({
      actionId: "confluent.topic.provision",
      session: {
        userId: "user-1",
        email: "admin@example.com",
        role: "admin",
        source: "google",
        organizationIds: [],
        platformAdmin: false,
      },
      environment: "live",
      actionRisk: "provider-write",
      reason: " Approved change ",
    });

    expect(record).toMatchObject({
      event: "apicenter.management.action.authorized",
      actionId: "confluent.topic.provision",
      operatorEmail: "admin@example.com",
      operatorRole: "admin",
      environment: "live",
      actionRisk: "provider-write",
      reason: "Approved change",
    });
    expect(JSON.stringify(record)).not.toContain("APPLY LIVE CHANGE");
  });

  it("emits structured JSON for platform logs", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const record = createManagementActionAuditRecord({
      actionId: "tribe-secret.provision",
      session: {
        userId: "user-2",
        email: "operator@example.com",
        role: "operator",
        source: "google",
        organizationIds: [],
        platformAdmin: false,
      },
      environment: "test",
      actionRisk: "provider-write",
    });

    emitManagementActionAudit(record);

    expect(info).toHaveBeenCalledWith(JSON.stringify(record));
    info.mockRestore();
  });
});
