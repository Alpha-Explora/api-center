import { AuditEventsService } from "./audit-events.service";

describe("AuditEventsService", () => {
  let service: AuditEventsService;

  beforeEach(() => {
    service = new AuditEventsService(
      { redis: { cacheUrl: "" } } as any,
      { info: jest.fn(), warn: jest.fn() } as any,
    );
  });

  it("filters audit events by action family and actor", async () => {
    await service.record({
      type: "quota.policy.updated",
      severity: "info",
      message: "Quota policy updated",
      actor: "platform@example.test",
      actionFamily: "quota",
      payload: { ownerTribeId: "campus-one" },
    } as any);
    await service.record({
      type: "secret.rotated",
      severity: "info",
      message: "Secret rotated",
      actor: "security@example.test",
      actionFamily: "secret",
    } as any);

    const events = await service.list({
      actionFamily: "quota",
      actor: "platform@example.test",
    } as any);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("quota.policy.updated");
  });

  it("filters audit events by inclusive date range", async () => {
    await service.record({
      type: "quota.policy.updated",
      severity: "info",
      message: "Quota policy updated",
      timestamp: "2026-05-20T12:00:00.000Z",
    } as any);
    await service.record({
      type: "secret.rotated",
      severity: "info",
      message: "Secret rotated",
      timestamp: "2026-05-26T00:00:00.000Z",
    } as any);

    const events = await service.list({
      from: "2026-05-01",
      to: "2026-05-25",
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("quota.policy.updated");
  });
});
