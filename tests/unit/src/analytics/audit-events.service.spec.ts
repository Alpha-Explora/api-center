import { AuditEventsService } from "../../../../apps/gateway/src/analytics/audit-events.service";

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

  it("dual-writes audit events to Postgres when database mode is enabled", async () => {
    const original = process.env.DATABASE_ENABLED;
    process.env.DATABASE_ENABLED = "true";
    const prisma = {
      auditEvent: {
        create: jest.fn(async () => ({})),
        findMany: jest.fn(),
      },
    };
    const logger = { info: jest.fn(), warn: jest.fn() };
    const databaseBackedService = new AuditEventsService(
      { redis: { cacheUrl: "" } } as any,
      logger as any,
      prisma as any,
    );

    try {
      const record = await databaseBackedService.record({
        type: "quota.policy.updated",
        severity: "warning",
        message: "Quota policy updated",
        actor: "platform@example.test",
        actionFamily: "quota",
        serviceId: "orders-api",
        payload: { ownerTribeId: "campus-one" },
        timestamp: "2026-05-20T12:00:00.000Z",
      } as any);

      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: record.id,
          actorType: "operator",
          actorId: "platform@example.test",
          action: "quota.policy.updated",
          resourceType: "service",
          resourceId: "orders-api",
          environment: "unknown",
          outcome: "succeeded",
          createdAt: new Date("2026-05-20T12:00:00.000Z"),
          metadata: expect.objectContaining({
            actionFamily: "quota",
            severity: "warning",
            serviceId: "orders-api",
            environment: "unknown",
          }),
        }),
      });
    } finally {
      if (original === undefined) delete process.env.DATABASE_ENABLED;
      else process.env.DATABASE_ENABLED = original;
    }
  });

  it("maps platform-admin audit actors to the database-compatible operator actor type", async () => {
    const original = process.env.DATABASE_ENABLED;
    process.env.DATABASE_ENABLED = "true";
    const prisma = {
      auditEvent: {
        create: jest.fn(async () => ({})),
        findMany: jest.fn(),
      },
    };
    const databaseBackedService = new AuditEventsService(
      { redis: { cacheUrl: "" } } as any,
      { info: jest.fn(), warn: jest.fn() } as any,
      prisma as any,
    );

    try {
      await databaseBackedService.recordRequired({
        type: "registry.service.create_requested",
        severity: "info",
        message: "registry.service.create_requested for church-donations",
        actor: "platform-admin",
        actionFamily: "registration",
        serviceId: "church-donations",
        resourceType: "service",
        resourceId: "church-donations",
        environment: "test",
        correlationId: "corr-register",
      } as any);

      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorType: "operator",
          actorId: "platform-admin",
          action: "registry.service.create_requested",
        }),
      });
    } finally {
      if (original === undefined) delete process.env.DATABASE_ENABLED;
      else process.env.DATABASE_ENABLED = original;
    }
  });
  it("recordRequired fails closed when Postgres audit persistence fails in database mode", async () => {
    const original = process.env.DATABASE_ENABLED;
    process.env.DATABASE_ENABLED = "true";
    const prisma = {
      auditEvent: {
        create: jest.fn(async () => {
          throw new Error("database unavailable");
        }),
        findMany: jest.fn(),
      },
    };
    const databaseBackedService = new AuditEventsService(
      { redis: { cacheUrl: "" } } as any,
      { info: jest.fn(), warn: jest.fn() } as any,
      prisma as any,
    );

    try {
      await expect(
        databaseBackedService.recordRequired({
          type: "quota.policy.updated",
          severity: "warning",
          message: "Quota policy updated",
          actor: "platform@example.test",
          actionFamily: "quota",
          resourceType: "quota_policy",
          resourceId: "quota-policy-1",
          environment: "live",
          correlationId: "corr-audit",
        } as any),
      ).rejects.toThrow("Postgres write failed");
    } finally {
      if (original === undefined) delete process.env.DATABASE_ENABLED;
      else process.env.DATABASE_ENABLED = original;
    }
  });

  it("lists durable audit events from Postgres when database mode is enabled", async () => {
    const original = process.env.DATABASE_ENABLED;
    process.env.DATABASE_ENABLED = "true";
    const prisma = {
      auditEvent: {
        create: jest.fn(),
        findMany: jest.fn(async () => [
          {
            id: "00000000-0000-0000-0000-000000000001",
            correlationId: null,
            actorType: "operator",
            actorId: "platform@example.test",
            action: "quota.policy.updated",
            resourceType: "service",
            resourceId: "orders-api",
            environment: "test",
            outcome: "succeeded",
            metadata: {
              actionFamily: "quota",
              severity: "info",
              message: "Quota policy updated",
              serviceId: "orders-api",
              payload: { ownerTribeId: "campus-one" },
            },
            createdAt: new Date("2026-05-20T12:00:00.000Z"),
          },
        ]),
      },
    };
    const databaseBackedService = new AuditEventsService(
      { redis: { cacheUrl: "" } } as any,
      { info: jest.fn(), warn: jest.fn() } as any,
      prisma as any,
    );

    try {
      await expect(
        databaseBackedService.list({
          actionFamily: "quota",
          actor: "platform@example.test",
          serviceId: "orders-api",
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          id: "00000000-0000-0000-0000-000000000001",
          type: "quota.policy.updated",
          serviceId: "orders-api",
          actionFamily: "quota",
          environment: "test",
        }),
      ]);
      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: "desc" },
        take: 500,
      });
    } finally {
      if (original === undefined) delete process.env.DATABASE_ENABLED;
      else process.env.DATABASE_ENABLED = original;
    }
  });

  it("returns durable source metadata when audit events come from Postgres", async () => {
    const original = process.env.DATABASE_ENABLED;
    process.env.DATABASE_ENABLED = "true";
    const prisma = {
      auditEvent: {
        create: jest.fn(),
        findMany: jest.fn(async () => [
          {
            id: "00000000-0000-0000-0000-000000000001",
            correlationId: null,
            actorType: "operator",
            actorId: "platform@example.test",
            action: "quota.policy.updated",
            resourceType: "service",
            resourceId: "orders-api",
            environment: "live",
            outcome: "succeeded",
            metadata: {
              actionFamily: "quota",
              severity: "info",
              message: "Quota policy updated",
              serviceId: "orders-api",
            },
            createdAt: new Date("2026-05-20T12:00:00.000Z"),
          },
        ]),
      },
    };
    const databaseBackedService = new AuditEventsService(
      { redis: { cacheUrl: "" } } as any,
      { info: jest.fn(), warn: jest.fn() } as any,
      prisma as any,
    );

    try {
      const result = await databaseBackedService.listWithSourceMetadata({
        serviceId: "orders-api",
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].environment).toBe("live");
      expect(result.sourceMetadata).toEqual(
        expect.objectContaining({
          sourceType: "durable",
          sourceName: "audit-events-postgres",
          durability: "postgres",
          evidenceTable: "apic_audit.audit_events",
        }),
      );
    } finally {
      if (original === undefined) delete process.env.DATABASE_ENABLED;
      else process.env.DATABASE_ENABLED = original;
    }
  });
});
