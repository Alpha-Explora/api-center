import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PipelineHealthService } from "./pipeline-health.service";

describe("PipelineHealthService", () => {
  it("reads and filters fixture rows by environment", async () => {
    const filePath = await writeFixtureFile();
    const service = new PipelineHealthService({
      source: "fixture",
      fixtureFilePath: filePath,
    });

    await expect(service.listHealth("test")).resolves.toEqual([
      expect.objectContaining({
        environment: "test",
        tribeId: "codex-sdk-20260520041053",
        sourceServiceId: "codex-sdk-20260520041053-api",
        eventType: "codex.pipeline.flush",
        eventCount: 1000,
      }),
    ]);
  });

  it("maps Athena query results into pipeline health rows", async () => {
    const athenaRunner = {
      run: jest.fn(async () => ({
        queryExecutionId: "query-1",
        outputLocation:
          "s3://api-center-athena-results/athena-results/platform/validation/test/query-1.csv",
        bytesScanned: 4096,
        completedAt: "2026-05-21T00:00:01.000Z",
        rows: [
          {
            environment: "test",
            tribe_id: "codex-sdk-20260520041053",
            source_service_id: "codex-sdk-20260520041053-api",
            event_type: "codex.pipeline.flush",
            event_day: "2026-05-20",
            event_count: "1000",
            latest_occurred_at: "2026-05-20T09:41:45.721Z",
            latest_ingested_at: "2026-05-20 14:27:36.973 UTC",
          },
        ],
      })),
    };
    const athenaTelemetry = {
      emitQueryCompleted: jest.fn(async () => undefined),
    };
    const service = new PipelineHealthService({
      source: "athena",
      athenaRunner,
      athenaTelemetry,
      year: "2026",
      month: "05",
      day: "20",
      pollSeconds: 0,
    });

    const rows = await service.listHealth("test");

    expect(rows).toEqual([
      expect.objectContaining({
        environment: "test",
        tribeId: "codex-sdk-20260520041053",
        eventCount: 1000,
        athenaResultLocation:
          "s3://api-center-athena-results/athena-results/platform/validation/test/query-1.csv",
        bytesScanned: 4096,
      }),
    ]);
    expect(athenaRunner.run).toHaveBeenCalledWith({
      query: expect.stringContaining("year = '2026'"),
      database: "gold_platform",
      workgroup: "api-center-platform-validation-test",
    });
    expect(athenaTelemetry.emitQueryCompleted).toHaveBeenCalledWith({
      environment: "test",
      database: "gold_platform",
      workgroup: "api-center-platform-validation-test",
      resultPurpose: "pipeline-health",
      queryExecutionId: "query-1",
      bytesScanned: 4096,
      outputLocation:
        "s3://api-center-athena-results/athena-results/platform/validation/test/query-1.csv",
      completedAt: "2026-05-21T00:00:01.000Z",
    });
  });

  it("returns Athena health rows when telemetry publish fails", async () => {
    const athenaRunner = {
      run: jest.fn(async () => ({
        queryExecutionId: "query-1",
        bytesScanned: 4096,
        rows: [
          {
            environment: "test",
            tribe_id: "codex-sdk-20260520041053",
            source_service_id: "codex-sdk-20260520041053-api",
            event_type: "codex.pipeline.flush",
            event_day: "2026-05-20",
            event_count: "1000",
          },
        ],
      })),
    };
    const service = new PipelineHealthService({
      source: "athena",
      athenaRunner,
      athenaTelemetry: {
        emitQueryCompleted: jest.fn(() => {
          throw new Error("kafka-down");
        }),
      },
      year: "2026",
      month: "05",
      day: "20",
    });

    await expect(service.listHealth("test")).resolves.toHaveLength(1);
  });

  it("uses request partition date overrides for Athena health reads", async () => {
    const athenaRunner = {
      run: jest.fn(async () => ({
        queryExecutionId: "query-override",
        bytesScanned: 1,
        rows: [
          {
            environment: "prod",
            tribe_id: "logistics",
            source_service_id: "logistics-orders",
            event_type: "order.created",
            event_day: "2026-05-20",
            event_count: "1000",
          },
        ],
      })),
    };
    const service = new PipelineHealthService({
      source: "athena",
      athenaRunner,
      year: "2026",
      month: "05",
      day: "21",
    });

    await expect(
      service.listHealth("prod", {
        year: "2026",
        month: "05",
        day: "20",
      }),
    ).resolves.toHaveLength(1);

    expect(athenaRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("day = '20'"),
      }),
    );
  });
});

async function writeFixtureFile() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apic-pipeline-health-"));
  const filePath = path.join(dir, "pipeline-health.json");
  await writeFile(
    filePath,
    JSON.stringify({
      rows: [
        {
          environment: "test",
          tribe_id: "codex-sdk-20260520041053",
          source_service_id: "codex-sdk-20260520041053-api",
          event_type: "codex.pipeline.flush",
          event_day: "2026-05-20",
          event_count: "1000",
        },
        {
          environment: "prod",
          tribe_id: "payments",
          source_service_id: "payments-api",
          event_type: "payment.completed",
          event_day: "2026-05-20",
          event_count: 2,
        },
      ],
    }),
    "utf8",
  );
  return filePath;
}
