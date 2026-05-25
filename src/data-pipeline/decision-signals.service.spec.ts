import { mkdtemp, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DecisionSignalsService } from "./decision-signals.service";

describe("DecisionSignalsService", () => {
  it("reads deterministic decision signals from fixture rows by environment", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "apic-decision-signals-"));
    const filePath = path.join(dir, "signals.json");
    await writeFile(
      filePath,
      JSON.stringify({
        decisionSignalRows: [
          {
            signal_id: "sig-test-1",
            environment: "test",
            tribe_id: "logistics",
            source_service_id: "orders-api",
            signal_type: "bronze_quality_regression",
            severity: "high",
            metric_name: "invalid_event_count",
            observed_value: "3",
            expected_value: "0",
            recommendation: "request tribe fix",
            evidence_query_id: "query-1",
            evidence_window_start: "2026-05-20T00:00:00.000Z",
            evidence_window_end: "2026-05-20T23:59:59.999Z",
            created_at: "2026-05-21T00:00:00.000Z",
            status: "open",
          },
          {
            signal_id: "sig-prod-1",
            environment: "prod",
            tribe_id: "logistics",
            signal_type: "athena_cost_spike",
            severity: "medium",
            metric_name: "bytes_scanned",
            observed_value: "1073741825",
            expected_value: "1073741824",
            recommendation: "materialize or narrow the query",
            evidence_window_start: "2026-05-20T00:00:00.000Z",
            evidence_window_end: "2026-05-20T23:59:59.999Z",
            created_at: "2026-05-21T00:00:00.000Z",
            status: "open",
          },
        ],
      }),
    );

    const service = new DecisionSignalsService({
      source: "fixture",
      fixtureFilePath: filePath,
    });

    await expect(service.listSignals("test")).resolves.toEqual([
      {
        signalId: "sig-test-1",
        environment: "test",
        tribeId: "logistics",
        sourceServiceId: "orders-api",
        signalType: "bronze_quality_regression",
        severity: "high",
        metricName: "invalid_event_count",
        observedValue: 3,
        expectedValue: 0,
        recommendation: "request tribe fix",
        evidenceQueryId: "query-1",
        evidenceWindowStart: "2026-05-20T00:00:00.000Z",
        evidenceWindowEnd: "2026-05-20T23:59:59.999Z",
        createdAt: "2026-05-21T00:00:00.000Z",
        status: "open",
      },
    ]);
  });

  it("queries Athena decision signals with an environment partition and emits telemetry", async () => {
    const athenaRunner = {
      run: jest.fn().mockResolvedValue({
        queryExecutionId: "query-123",
        bytesScanned: 1024,
        outputLocation:
          "s3://api-center-athena-results/athena-results/platform/validation/test/query-123.csv",
        completedAt: "2026-05-21T00:00:00.000Z",
        rows: [
          {
            signal_id: "sig-test-1",
            environment: "test",
            tribe_id: "logistics",
            signal_type: "gateway_denial_spike",
            severity: "medium",
            metric_name: "denied_count",
            observed_value: "2",
            expected_value: "0",
            recommendation: "review gateway policy or tribe scope request",
            evidence_query_id: "query-123",
            evidence_window_start: "2026-05-20T00:00:00.000Z",
            evidence_window_end: "2026-05-20T23:59:59.999Z",
            created_at: "2026-05-21T00:00:00.000Z",
            status: "open",
          },
        ],
      }),
    };
    const athenaTelemetry = {
      emitQueryCompleted: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DecisionSignalsService({
      source: "athena",
      athenaRunner,
      athenaTelemetry,
      year: "2026",
      month: "05",
      day: "20",
    });

    await expect(service.listSignals("test")).resolves.toHaveLength(1);
    expect(athenaRunner.run).toHaveBeenCalledWith({
      database: "gold_platform",
      workgroup: "api-center-platform-validation-test",
      query: expect.stringContaining(
        "FROM gold_platform.decision_signals_daily",
      ),
    });
    expect(athenaRunner.run.mock.calls[0][0].query).toContain(
      "WHERE environment = 'test'",
    );
    expect(athenaRunner.run.mock.calls[0][0].query).toContain("year = '2026'");
    expect(athenaTelemetry.emitQueryCompleted).toHaveBeenCalledWith({
      environment: "test",
      database: "gold_platform",
      workgroup: "api-center-platform-validation-test",
      resultPurpose: "pipeline-decision-signals",
      queryExecutionId: "query-123",
      bytesScanned: 1024,
      outputLocation:
        "s3://api-center-athena-results/athena-results/platform/validation/test/query-123.csv",
      completedAt: "2026-05-21T00:00:00.000Z",
    });
  });

  it("inherits the governance Athena source setting when no decision-specific source is set", async () => {
    const previous = process.env.PIPELINE_GOVERNANCE_SOURCE;
    process.env.PIPELINE_GOVERNANCE_SOURCE = "athena";
    const athenaRunner = {
      run: jest.fn().mockResolvedValue({
        queryExecutionId: "query-123",
        rows: [],
      }),
    };

    try {
      const service = new DecisionSignalsService({ athenaRunner });
      await service.listSignals("test", {
        year: "2026",
        month: "05",
        day: "20",
      });
      expect(service.getResponseSource()).toBe("athena-proxy");
      expect(athenaRunner.run).toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.PIPELINE_GOVERNANCE_SOURCE;
      } else {
        process.env.PIPELINE_GOVERNANCE_SOURCE = previous;
      }
    }
  });

  it("bounds Athena decision signal reads to an evidence window when requested", async () => {
    const athenaRunner = {
      run: jest.fn().mockResolvedValue({
        queryExecutionId: "query-window",
        rows: [],
      }),
    };
    const service = new DecisionSignalsService({
      source: "athena",
      athenaRunner,
      year: "2026",
      month: "05",
      day: "23",
    });

    await service.listSignals(
      "test",
      { year: "2026", month: "05", day: "23" },
      30,
    );

    expect(athenaRunner.run.mock.calls[0][0].query).toContain(
      "CAST(evidence_window_start AS date) BETWEEN date_add('day', -29, DATE '2026-05-23') AND DATE '2026-05-23'",
    );
  });
});
