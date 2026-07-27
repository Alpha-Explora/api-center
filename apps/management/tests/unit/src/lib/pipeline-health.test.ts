import { describe, expect, it } from "vitest";
import {
  filterPipelineHealthRows,
  normalizePipelineHealthRows,
} from "../../../../src/lib/pipeline-health";

describe("pipeline health rows", () => {
  it("normalizes Athena-style snake case rows into panel rows", () => {
    const rows = normalizePipelineHealthRows([
      {
        environment: "test",
        tribe_id: "codex-sdk-20260520041053",
        source_service_id: "codex-sdk-20260520041053-api",
        event_type: "codex.pipeline.flush",
        event_day: "2026-05-20",
        event_count: 1000,
        latest_occurred_at: "2026-05-20T09:41:45.721Z",
        latest_ingested_at: "2026-05-20T09:42:00.000Z",
        connector_name: "apicenter-test-s3-sink",
        connector_state: "RUNNING",
        s3_prefix: "topics/test/tribe.codex.events/",
        latest_s3_object_key:
          "topics/test/tribe.codex.events/event_day=2026-05-20/part-000.json",
        latest_s3_object_at: "2026-05-20T09:42:30.000Z",
        latest_bronze_observed_at: "2026-05-20T09:43:00.000Z",
        latest_common_silver_observed_at: "2026-05-20T09:44:00.000Z",
        latest_gold_observed_at: "2026-05-20T09:45:00.000Z",
        quality_error_count: "0",
        athena_result_location:
          "s3://api-center-athena-results/management/test/query.csv",
        bytes_scanned: "4096",
        last_refreshed_at: "2026-05-20T09:46:00.000Z",
      },
    ]);

    expect(rows).toEqual([
      {
        environment: "test",
        tribeId: "codex-sdk-20260520041053",
        sourceServiceId: "codex-sdk-20260520041053-api",
        eventType: "codex.pipeline.flush",
        eventDay: "2026-05-20",
        eventCount: 1000,
        latestOccurredAt: "2026-05-20T09:41:45.721Z",
        latestIngestedAt: "2026-05-20T09:42:00.000Z",
        connectorName: "apicenter-test-s3-sink",
        connectorState: "RUNNING",
        s3Prefix: "topics/test/tribe.codex.events/",
        latestS3ObjectKey:
          "topics/test/tribe.codex.events/event_day=2026-05-20/part-000.json",
        latestS3ObjectAt: "2026-05-20T09:42:30.000Z",
        latestBronzeObservedAt: "2026-05-20T09:43:00.000Z",
        latestCommonSilverObservedAt: "2026-05-20T09:44:00.000Z",
        latestGoldObservedAt: "2026-05-20T09:45:00.000Z",
        qualityErrorCount: 0,
        athenaResultLocation:
          "s3://api-center-athena-results/management/test/query.csv",
        bytesScanned: 4096,
        lastRefreshedAt: "2026-05-20T09:46:00.000Z",
      },
    ]);
  });

  it("keeps prod and test rows isolated by environment", () => {
    const rows = normalizePipelineHealthRows([
      {
        environment: "test",
        tribe_id: "codex",
        event_type: "codex.pipeline.flush",
        event_day: "2026-05-20",
        event_count: 1,
      },
      {
        environment: "prod",
        tribe_id: "payments",
        event_type: "payment.completed",
        event_day: "2026-05-20",
        event_count: 2,
      },
    ]);

    expect(filterPipelineHealthRows(rows, "test")).toHaveLength(1);
    expect(filterPipelineHealthRows(rows, "test")[0]?.tribeId).toBe("codex");
    expect(filterPipelineHealthRows(rows, "prod")).toHaveLength(1);
    expect(filterPipelineHealthRows(rows, "prod")[0]?.tribeId).toBe("payments");
  });
});
