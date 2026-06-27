import { RawToSilverRunService } from "./raw-to-silver-run.service";

describe("RawToSilverRunService", () => {
  it("previews bounded raw to Common Silver validation and materialization SQL", async () => {
    const athenaRunner = {
      run: jest.fn(),
    };
    const service = new RawToSilverRunService({
      athenaRunner,
      now: () => new Date("2026-05-23T01:00:00.000Z"),
    });

    const result = await service.startRun({
      environment: "test",
      tribeId: "greenovate",
      partition: { year: "2026", month: "05", day: "22" },
      materialize: true,
      preview: true,
    });

    expect(athenaRunner.run).not.toHaveBeenCalled();
    expect(result.status).toBe("preview");
    expect(result.physicalTopic).toBe("test.tribe.greenovate.events");
    expect(result.materialization).toEqual(
      expect.objectContaining({
        requested: true,
        targetTable:
          "materialized_platform.common_silver_tribe_event_envelope_greenovate_test_20260522",
        externalLocation:
          "s3://api-center-curated-data/silver/common_silver/tribe_event_envelope/tribe_id=greenovate/environment=test/year=2026/month=05/day=22/",
      }),
    );
    expect(result.previewQueries.raw).toContain(
      "physical_topic = 'test.tribe.greenovate.events'",
    );
    expect(result.previewQueries.commonSilver).toContain(
      "FROM common_silver.tribe_event_envelope",
    );
    expect(result.previewQueries.materialize).toContain("CREATE TABLE");
  });

  it("runs raw, Bronze, Common Silver, and materialization queries in order", async () => {
    const athenaRunner = {
      run: jest
        .fn()
        .mockResolvedValueOnce({
          queryExecutionId: "raw-query",
          rows: [{ row_count: "8" }],
          bytesScanned: 100,
          outputLocation: "s3://results/raw.csv",
          completedAt: "2026-05-23T01:01:00.000Z",
        })
        .mockResolvedValueOnce({
          queryExecutionId: "bronze-query",
          rows: [{ row_count: "8" }],
          bytesScanned: 200,
          outputLocation: "s3://results/bronze.csv",
          completedAt: "2026-05-23T01:02:00.000Z",
        })
        .mockResolvedValueOnce({
          queryExecutionId: "silver-query",
          rows: [{ row_count: "8" }],
          bytesScanned: 300,
          outputLocation: "s3://results/silver.csv",
          completedAt: "2026-05-23T01:03:00.000Z",
        })
        .mockResolvedValueOnce({
          queryExecutionId: "create-db-query",
          rows: [],
          completedAt: "2026-05-23T01:04:00.000Z",
        })
        .mockResolvedValueOnce({
          queryExecutionId: "ctas-query",
          rows: [],
          outputLocation: "s3://results/ctas.csv",
          completedAt: "2026-05-23T01:05:00.000Z",
        }),
    };
    const service = new RawToSilverRunService({ athenaRunner });

    const result = await service.startRun({
      environment: "test",
      tribeId: "greenovate",
      partition: { year: "2026", month: "05", day: "22" },
      materialize: true,
    });

    expect(result.status).toBe("completed");
    expect(result.raw.rowCount).toBe(8);
    expect(result.bronze.rowCount).toBe(8);
    expect(result.commonSilver.rowCount).toBe(8);
    expect(result.materialization?.queryExecutionId).toBe("ctas-query");
    expect(athenaRunner.run).toHaveBeenCalledTimes(5);
    expect(athenaRunner.run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        database: "api_center_raw",
        workgroup: "api-center-platform-validation-test",
      }),
    );
    expect(athenaRunner.run).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        database: "materialized_platform",
        workgroup: "api-center-materialization-test",
        query: "CREATE DATABASE IF NOT EXISTS materialized_platform",
      }),
    );
  });

  it("blocks materialization when Common Silver has no rows", async () => {
    const athenaRunner = {
      run: jest
        .fn()
        .mockResolvedValueOnce({
          queryExecutionId: "raw",
          rows: [{ row_count: "1" }],
        })
        .mockResolvedValueOnce({
          queryExecutionId: "bronze",
          rows: [{ row_count: "1" }],
        })
        .mockResolvedValueOnce({
          queryExecutionId: "silver",
          rows: [{ row_count: "0" }],
        }),
    };
    const service = new RawToSilverRunService({ athenaRunner });

    const result = await service.startRun({
      environment: "live",
      tribeId: "logistics",
      partition: { year: "2026", month: "05", day: "20" },
      materialize: true,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockedReason).toBe("Common Silver returned zero rows.");
    expect(result.materialization?.queryExecutionId).toBeUndefined();
    expect(athenaRunner.run).toHaveBeenCalledTimes(3);
  });
  it("maps public live runs to physical prod topics while keeping live partitions", async () => {
    const service = new RawToSilverRunService({
      athenaRunner: { run: jest.fn() },
      now: () => new Date("2026-05-23T01:00:00.000Z"),
    });

    const result = await service.startRun({
      environment: "live",
      tribeId: "greenovate",
      partition: { year: "2026", month: "05", day: "22" },
      materialize: true,
      preview: true,
    });

    expect(result.environment).toBe("live");
    expect(result.physicalTopic).toBe("prod.tribe.greenovate.events");
    expect(result.previewQueries.raw).toContain("physical_topic = 'prod.tribe.greenovate.events'");
    expect(result.previewQueries.bronze).toContain("environment = 'prod'");
    expect(result.materialization?.targetTable).toContain("_live_20260522");
    expect(result.materialization?.externalLocation).toContain(
      "tribe_id=greenovate/environment=live/year=2026/month=05/day=22/",
    );
  });
});
