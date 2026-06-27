import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PipelineGovernanceService } from "./pipeline-governance.service";

describe("PipelineGovernanceService", () => {
  it("reads and filters fixture governance rows by environment", async () => {
    const filePath = await writeFixtureFile();
    const service = new PipelineGovernanceService({
      source: "fixture",
      fixtureFilePath: filePath,
    });

    await expect(service.listQuality("test")).resolves.toEqual([
      expect.objectContaining({
        environment: "test",
        tribeId: "logistics",
        sourceServiceId: "logistics-orders",
        eventType: "order.created",
        eventCount: 1000,
        qualityErrorCount: 0,
      }),
    ]);
    await expect(service.listCost("live")).resolves.toEqual([
      expect.objectContaining({
        environment: "live",
        workgroup: "api-center-platform-validation-prod",
        bytesScanned: 1024,
        estimatedCostUsd: 0.00000477,
      }),
    ]);
  });

  it("maps Athena query results into gateway decision rows", async () => {
    const athenaRunner = {
      run: jest.fn(async () => ({
        queryExecutionId: "query-1",
        outputLocation:
          "s3://api-center-athena-results/athena-results/platform/validation/test/query-1.csv",
        bytesScanned: 2048,
        completedAt: "2026-05-21T00:00:01.000Z",
        rows: [
          {
            environment: "test",
            tribe_id: "logistics",
            source_service_id: "logistics-orders",
            target_service_id: "payment",
            scope: "payment:charge:create",
            decision: "denied",
            event_day: "2026-05-20",
            decision_count: "2",
            allowed_count: "0",
            denied_count: "2",
            avg_latency_ms: "25.5",
            latest_occurred_at: "2026-05-20T18:41:00.483Z",
            latest_ingested_at: "2026-05-20 18:42:02.167 UTC",
          },
        ],
      })),
    };
    const athenaTelemetry = {
      emitQueryCompleted: jest.fn(async () => undefined),
    };
    const service = new PipelineGovernanceService({
      source: "athena",
      athenaRunner,
      athenaTelemetry,
      year: "2026",
      month: "05",
      day: "20",
      pollSeconds: 0,
    });

    await expect(service.listGatewayDecisions("test")).resolves.toEqual([
      expect.objectContaining({
        tribeId: "logistics",
        sourceServiceId: "logistics-orders",
        targetServiceId: "payment",
        decision: "denied",
        decisionCount: 2,
        avgLatencyMs: 25.5,
      }),
    ]);
    expect(athenaRunner.run).toHaveBeenCalledWith({
      query: expect.stringContaining("gateway_decision_daily"),
      database: "gold_platform",
      workgroup: "api-center-platform-validation-test",
    });
    expect(athenaTelemetry.emitQueryCompleted).toHaveBeenCalledWith({
      environment: "test",
      database: "gold_platform",
      workgroup: "api-center-platform-validation-test",
      resultPurpose: "pipeline-gateway-decisions",
      queryExecutionId: "query-1",
      bytesScanned: 2048,
      outputLocation:
        "s3://api-center-athena-results/athena-results/platform/validation/test/query-1.csv",
      completedAt: "2026-05-21T00:00:01.000Z",
    });
  });

  it("returns Athena governance rows when telemetry publish fails", async () => {
    const athenaRunner = {
      run: jest.fn(async () => ({
        queryExecutionId: "query-1",
        bytesScanned: 2048,
        rows: [
          {
            environment: "test",
            tribe_id: "logistics",
            source_service_id: "logistics-orders",
            target_service_id: "payment",
            scope: "payment:charge:create",
            decision: "denied",
            event_day: "2026-05-20",
            decision_count: "2",
            allowed_count: "0",
            denied_count: "2",
          },
        ],
      })),
    };
    const service = new PipelineGovernanceService({
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

    await expect(service.listGatewayDecisions("test")).resolves.toHaveLength(1);
  });

  it("uses request partition date overrides for Athena governance reads", async () => {
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
            valid_event_count: "1000",
            invalid_event_count: "0",
            quality_error_count: "0",
          },
        ],
      })),
    };
    const service = new PipelineGovernanceService({
      source: "athena",
      athenaRunner,
      year: "2026",
      month: "05",
      day: "21",
    });

    await expect(
      service.listQuality("live", {
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

  it("bounds Athena governance reads to an event-day window when requested", async () => {
    const athenaRunner = {
      run: jest.fn(async () => ({
        queryExecutionId: "query-window",
        bytesScanned: 1,
        rows: [],
      })),
    };
    const service = new PipelineGovernanceService({
      source: "athena",
      athenaRunner,
      year: "2026",
      month: "05",
      day: "23",
    });

    await service.listGatewayDecisions(
      "test",
      { year: "2026", month: "05", day: "23" },
      30,
    );

    expect(athenaRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining(
          "event_day BETWEEN date_add('day', -29, DATE '2026-05-23') AND DATE '2026-05-23'",
        ),
      }),
    );
  });
});

async function writeFixtureFile() {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "apic-pipeline-governance-"),
  );
  const filePath = path.join(dir, "pipeline-governance.json");
  await writeFile(
    filePath,
    JSON.stringify({
      qualityRows: [
        {
          environment: "test",
          tribe_id: "logistics",
          source_service_id: "logistics-orders",
          event_type: "order.created",
          event_day: "2026-05-20",
          event_count: "1000",
          valid_event_count: "1000",
          invalid_event_count: "0",
          quality_error_count: "0",
        },
        {
          environment: "prod",
          tribe_id: "billing",
          event_type: "invoice.created",
          event_day: "2026-05-20",
          event_count: 1,
          valid_event_count: 1,
          invalid_event_count: 0,
          quality_error_count: 0,
        },
      ],
      sharedServiceUsageRows: [],
      gatewayDecisionRows: [],
      costRows: [
        {
          environment: "prod",
          workgroup: "api-center-platform-validation-prod",
          result_purpose: "platform-validation",
          event_day: "2026-05-20",
          query_count: "1",
          bytes_scanned: "1024",
          estimated_cost_usd: "0.00000477",
        },
      ],
    }),
    "utf8",
  );
  return filePath;
}
