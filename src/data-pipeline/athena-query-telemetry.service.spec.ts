import {
  AthenaQueryTelemetryService,
  ATHENA_QUERY_TELEMETRY_TOPIC_SUFFIX,
} from "./athena-query-telemetry.service";

describe("AthenaQueryTelemetryService", () => {
  it("publishes measured Athena query telemetry to the exact environment topic", async () => {
    const publisher = {
      publish: jest.fn(async () => undefined),
    };
    const service = new AthenaQueryTelemetryService({
      publisher,
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });

    await service.emitQueryCompleted({
      environment: "test",
      database: "gold_platform",
      workgroup: "api-center-platform-validation-test",
      resultPurpose: "pipeline-health",
      queryExecutionId: "query-123",
      bytesScanned: 2048,
      outputLocation:
        "s3://api-center-athena-results/athena-results/platform/validation/test/query-123.csv",
      completedAt: "2026-05-21T00:00:01.000Z",
    });

    expect(publisher.publish).toHaveBeenCalledWith(
      `test.${ATHENA_QUERY_TELEMETRY_TOPIC_SUFFIX}`,
      {
        eventType: "athena.query.completed",
        metadata: {
          schemaVersion: "1.0.0",
        },
        payload: {
          environment: "test",
          database: "gold_platform",
          workgroup: "api-center-platform-validation-test",
          resultPurpose: "pipeline-health",
          queryExecutionId: "query-123",
          bytesScanned: 2048,
          outputLocation:
            "s3://api-center-athena-results/athena-results/platform/validation/test/query-123.csv",
          completedAt: "2026-05-21T00:00:01.000Z",
        },
      },
      "api-center-platform-validation-test",
    );
  });

  it("uses current time when Athena did not return a completion timestamp", async () => {
    const publisher = {
      publish: jest.fn(async () => undefined),
    };
    const service = new AthenaQueryTelemetryService({
      publisher,
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });

    await service.emitQueryCompleted({
      environment: "prod",
      database: "gold_platform",
      workgroup: "api-center-platform-validation-prod",
      resultPurpose: "pipeline-quality",
      queryExecutionId: "query-456",
      bytesScanned: 0,
    });

    expect(publisher.publish).toHaveBeenCalledWith(
      `prod.${ATHENA_QUERY_TELEMETRY_TOPIC_SUFFIX}`,
      expect.objectContaining({
        payload: expect.objectContaining({
          completedAt: "2026-05-21T00:00:00.000Z",
        }),
      }),
      "api-center-platform-validation-prod",
    );
  });

  it("does not throw when telemetry publish fails", async () => {
    const publisher = {
      publish: jest.fn(async () => {
        throw new Error("kafka-down");
      }),
    };
    const service = new AthenaQueryTelemetryService({ publisher });

    await expect(
      service.emitQueryCompleted({
        environment: "test",
        database: "gold_platform",
        workgroup: "api-center-platform-validation-test",
        resultPurpose: "pipeline-health",
        queryExecutionId: "query-123",
        bytesScanned: 2048,
      }),
    ).resolves.toBeUndefined();
  });
});
