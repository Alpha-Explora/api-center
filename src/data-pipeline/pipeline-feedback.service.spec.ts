import { PipelineFeedbackService } from "./pipeline-feedback.service";

describe("PipelineFeedbackService", () => {
  it("creates a feedback record with actor, role, reason, and timestamp", async () => {
    const service = new PipelineFeedbackService({
      now: () => new Date("2026-05-21T00:00:00.000Z"),
      idFactory: () => "pfb_test_1",
    });

    const record = await service.createFeedbackAction(
      {
        action: "evidence.reviewed",
        environment: "test",
        targetType: "topic",
        targetId: "test.tribe.logistics.events",
        evidenceLink:
          "s3://api-center-athena-results/athena-results/platform/validation/test/query.csv",
        reason: "Reviewed test evidence",
      },
      {
        actorId: "operator@example.com",
        actorRole: "platform-admin",
        correlationId: "corr_feedback_test",
      },
    );

    expect(record).toEqual({
      id: "pfb_test_1",
      action: "evidence.reviewed",
      environment: "test",
      targetType: "topic",
      targetId: "test.tribe.logistics.events",
      evidenceLink:
        "s3://api-center-athena-results/athena-results/platform/validation/test/query.csv",
      reason: "Reviewed test evidence",
      actorId: "operator@example.com",
      actorRole: "platform-admin",
      correlationId: "corr_feedback_test",
      createdAt: "2026-05-21T00:00:00.000Z",
      status: "reviewed",
    });
  });

  it("rejects live promotion blocks without a non-empty reason", async () => {
    const service = new PipelineFeedbackService({
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });

    await expect(
      service.createFeedbackAction(
        {
          action: "promotion.blocked",
          environment: "live",
          targetType: "topic",
          targetId: "prod.tribe.logistics.events",
          reason: "   ",
        },
        {
          actorId: "operator@example.com",
          actorRole: "platform-admin",
        },
      ),
    ).rejects.toThrow("reason is required for live promotion.blocked");
  });

  it("lists records filtered by environment and target id", async () => {
    const service = new PipelineFeedbackService({
      now: () => new Date("2026-05-21T00:00:00.000Z"),
      idFactory: (() => {
        let next = 0;
        return () => `pfb_test_${++next}`;
      })(),
    });

    await service.createFeedbackAction(
      {
        action: "schema.fix.requested",
        environment: "test",
        targetType: "event",
        targetId: "order.created",
        ownerTribeId: "logistics",
        reason: "Schema error count exceeded threshold",
      },
      {
        actorId: "operator@example.com",
        actorRole: "platform-admin",
      },
    );
    await service.createFeedbackAction(
      {
        action: "validation.rerun.requested",
        environment: "live",
        targetType: "topic",
        targetId: "prod.tribe.logistics.events",
        reason: "Validate live partition",
      },
      {
        actorId: "operator@example.com",
        actorRole: "platform-admin",
      },
    );

    await expect(
      service.listFeedbackActions({
        environment: "test",
        targetId: "order.created",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "pfb_test_1",
        status: "pending",
        targetId: "order.created",
      }),
    ]);
  });

  it("records false-positive reviews against decision signals", async () => {
    const service = new PipelineFeedbackService({
      now: () => new Date("2026-05-21T00:00:00.000Z"),
      idFactory: () => "pfb_false_positive_signal",
    });

    await expect(
      service.createFeedbackAction(
        {
          action: "decision.false_positive.marked",
          environment: "test",
          targetType: "signal",
          targetId: "test:shared_service_error_spike:pakiapps:email:20260520",
          ownerTribeId: "pakiapps",
          evidenceLink: "cbde08d3-0488-4aeb-a50e-0e280bcb058e",
          reason: "Provider maintenance window already approved",
        },
        {
          actorId: "operator@example.com",
          actorRole: "platform-admin",
        },
      ),
    ).resolves.toMatchObject({
      id: "pfb_false_positive_signal",
      action: "decision.false_positive.marked",
      targetType: "signal",
      status: "closed",
    });
  });

  it("rejects false-positive reviews for non-signal targets", async () => {
    const service = new PipelineFeedbackService({
      now: () => new Date("2026-05-21T00:00:00.000Z"),
      idFactory: () => "pfb_invalid_false_positive",
    });

    await expect(
      service.createFeedbackAction(
        {
          action: "decision.false_positive.marked",
          environment: "test",
          targetType: "event",
          targetId: "order.created",
          reason: "False positive is only valid for decision signals",
        },
        {
          actorId: "operator@example.com",
          actorRole: "platform-admin",
        },
      ),
    ).rejects.toThrow(
      "decision.false_positive.marked requires targetType=signal",
    );
  });

  it("persists feedback records through Prisma when database mode is enabled", async () => {
    const prisma = {
      pipelineFeedbackActionRecord: {
        create: jest.fn(async () =>
          dbRow({
            id: "00000000-0000-0000-0000-000000000001",
            action: "evidence.reviewed",
            environment: "test",
            targetType: "topic",
            targetId: "test.api-center.pipeline.athena-query-execution",
            reason: "Reviewed test telemetry evidence",
            actorId: "operator@example.com",
            actorRole: "platform-admin",
            correlationId: "corr_postgres_feedback",
            status: "reviewed",
          }),
        ),
      },
    };
    const service = new PipelineFeedbackService(
      {
        databaseEnabled: true,
        now: () => new Date("2026-05-21T00:00:00.000Z"),
      },
      prisma as never,
    );

    const record = await service.createFeedbackAction(
      {
        action: "evidence.reviewed",
        environment: "test",
        targetType: "topic",
        targetId: "test.api-center.pipeline.athena-query-execution",
        reason: "Reviewed test telemetry evidence",
      },
      {
        actorId: "operator@example.com",
        actorRole: "platform-admin",
        correlationId: "corr_postgres_feedback",
      },
    );

    expect(prisma.pipelineFeedbackActionRecord.create).toHaveBeenCalledWith({
      data: {
        action: "evidence.reviewed",
        environment: "test",
        targetType: "topic",
        targetId: "test.api-center.pipeline.athena-query-execution",
        ownerTribeId: undefined,
        evidenceLink: undefined,
        reason: "Reviewed test telemetry evidence",
        actorId: "operator@example.com",
        actorRole: "platform-admin",
        correlationId: "corr_postgres_feedback",
        status: "reviewed",
      },
    });
    expect(record).toMatchObject({
      id: "00000000-0000-0000-0000-000000000001",
      correlationId: "corr_postgres_feedback",
      status: "reviewed",
    });
  });

  it("lists feedback records from Prisma when database mode is enabled", async () => {
    const prisma = {
      pipelineFeedbackActionRecord: {
        findMany: jest.fn(async () => [
          dbRow({
            targetId: "test.api-center.pipeline.athena-query-execution",
          }),
        ]),
      },
    };
    const service = new PipelineFeedbackService(
      { databaseEnabled: true },
      prisma as never,
    );

    await expect(
      service.listFeedbackActions({
        environment: "test",
        targetId: "test.api-center.pipeline.athena-query-execution",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        targetId: "test.api-center.pipeline.athena-query-execution",
      }),
    ]);

    expect(prisma.pipelineFeedbackActionRecord.findMany).toHaveBeenCalledWith({
      where: {
        environment: "test",
        targetId: "test.api-center.pipeline.athena-query-execution",
        targetType: undefined,
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("falls back to memory storage when Postgres is not enabled", async () => {
    const prisma = {
      pipelineFeedbackActionRecord: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const service = new PipelineFeedbackService(
      {
        databaseEnabled: false,
        idFactory: () => "pfb_memory_mode",
        now: () => new Date("2026-05-21T00:00:00.000Z"),
      },
      prisma as never,
    );

    await expect(
      service.createFeedbackAction(
        {
          action: "validation.rerun.requested",
          environment: "test",
          targetType: "topic",
          targetId: "test.api-center.pipeline.athena-query-execution",
          reason: "Validate without database mode",
        },
        {
          actorId: "operator@example.com",
          actorRole: "platform-admin",
        },
      ),
    ).resolves.toMatchObject({
      id: "pfb_memory_mode",
      targetId: "test.api-center.pipeline.athena-query-execution",
    });

    await expect(
      service.listFeedbackActions({
        environment: "test",
        targetId: "test.api-center.pipeline.athena-query-execution",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "pfb_memory_mode",
      }),
    ]);
    expect(prisma.pipelineFeedbackActionRecord.create).not.toHaveBeenCalled();
    expect(prisma.pipelineFeedbackActionRecord.findMany).not.toHaveBeenCalled();
  });

  it("fails closed when database mode is enabled without a Prisma client", async () => {
    const service = new PipelineFeedbackService({
      databaseEnabled: true,
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });

    await expect(
      service.createFeedbackAction(
        {
          action: "validation.rerun.requested",
          environment: "test",
          targetType: "topic",
          targetId: "test.api-center.pipeline.athena-query-execution",
          reason: "Must not fall back to memory in database mode",
        },
        {
          actorId: "operator@example.com",
          actorRole: "platform-admin",
        },
      ),
    ).rejects.toThrow(
      "DATABASE_ENABLED=true requires PrismaService for pipeline feedback persistence",
    );
  });
});

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    action: "validation.rerun.requested",
    environment: "test",
    targetType: "topic",
    targetId: "test.tribe.logistics.events",
    ownerTribeId: null,
    evidenceLink: null,
    reason: "Validate test evidence",
    actorId: "platform-admin",
    actorRole: "platform-admin",
    correlationId: null,
    status: "pending",
    createdAt: new Date("2026-05-21T00:00:00.000Z"),
    ...overrides,
  };
}
