import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
  StopQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { AthenaQueryRunner } from "../../../../src/data-pipeline/athena-query-runner";

describe("AthenaQueryRunner", () => {
  it("starts, polls, and maps Athena rows", async () => {
    const sent: unknown[] = [];
    const client = {
      send: jest.fn(async (command: unknown) => {
        sent.push(command);
        if (command instanceof StartQueryExecutionCommand) {
          return { QueryExecutionId: "query-1" };
        }
        if (command instanceof GetQueryExecutionCommand) {
          return {
            QueryExecution: {
              Status: {
                State: "SUCCEEDED",
                CompletionDateTime: new Date("2026-05-21T00:00:01.000Z"),
              },
              ResultConfiguration: {
                OutputLocation:
                  "s3://api-center-athena-results/athena-results/platform/validation/test/query-1.csv",
              },
              Statistics: {
                DataScannedInBytes: 2048,
              },
            },
          };
        }
        if (command instanceof GetQueryResultsCommand) {
          return {
            ResultSet: {
              Rows: [
                {
                  Data: [
                    { VarCharValue: "environment" },
                    { VarCharValue: "tribe_id" },
                  ],
                },
                {
                  Data: [
                    { VarCharValue: "test" },
                    { VarCharValue: "logistics" },
                  ],
                },
              ],
            },
          };
        }
        throw new Error("unexpected command");
      }),
    } as unknown as AthenaClient;

    const runner = new AthenaQueryRunner({
      client,
      pollSeconds: 0,
      timeoutSeconds: 10,
    });

    await expect(
      runner.run({
        query:
          "SELECT environment, tribe_id FROM gold_platform.pipeline_health_daily",
        database: "gold_platform",
        workgroup: "api-center-platform-validation-test",
      }),
    ).resolves.toEqual({
      queryExecutionId: "query-1",
      outputLocation:
        "s3://api-center-athena-results/athena-results/platform/validation/test/query-1.csv",
      bytesScanned: 2048,
      completedAt: "2026-05-21T00:00:01.000Z",
      rows: [{ environment: "test", tribe_id: "logistics" }],
    });
    expect(sent).toHaveLength(3);
  });

  it("fails with the Athena state change reason", async () => {
    const client = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof StartQueryExecutionCommand) {
          return { QueryExecutionId: "query-1" };
        }
        if (command instanceof GetQueryExecutionCommand) {
          return {
            QueryExecution: {
              Status: {
                State: "FAILED",
                StateChangeReason: "syntax error",
              },
            },
          };
        }
        throw new Error("unexpected command");
      }),
    } as unknown as AthenaClient;

    const runner = new AthenaQueryRunner({
      client,
      pollSeconds: 0,
      timeoutSeconds: 10,
    });

    await expect(
      runner.run({
        query: "SELECT broken",
        database: "gold_platform",
        workgroup: "api-center-platform-validation-test",
      }),
    ).rejects.toThrow("Athena query query-1 ended with FAILED: syntax error");
  });

  it("stops the Athena query when local polling times out", async () => {
    const sent: unknown[] = [];
    const client = {
      send: jest.fn(async (command: unknown) => {
        sent.push(command);
        if (command instanceof StartQueryExecutionCommand) {
          return { QueryExecutionId: "query-1" };
        }
        if (command instanceof GetQueryExecutionCommand) {
          return {
            QueryExecution: {
              Status: { State: "RUNNING" },
            },
          };
        }
        if (command instanceof StopQueryExecutionCommand) {
          return {};
        }
        throw new Error("unexpected command");
      }),
    } as unknown as AthenaClient;

    const runner = new AthenaQueryRunner({
      client,
      pollSeconds: 0,
      timeoutSeconds: 0,
    });

    await expect(
      runner.run({
        query: "SELECT slow",
        database: "gold_platform",
        workgroup: "api-center-platform-validation-test",
      }),
    ).rejects.toThrow("Athena query query-1 timed out after 0 seconds.");

    expect(
      sent.some((command) => command instanceof StopQueryExecutionCommand),
    ).toBe(true);
  });
});
