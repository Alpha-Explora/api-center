import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  Row,
  StartQueryExecutionCommand,
  StopQueryExecutionCommand,
} from "@aws-sdk/client-athena";

export type AthenaQueryRunnerOptions = {
  client?: AthenaClient;
  region?: string;
  pollSeconds?: number;
  timeoutSeconds?: number;
};

export type AthenaQueryInput = {
  query: string;
  database: string;
  workgroup: string;
};

export type AthenaQueryResult = {
  queryExecutionId: string;
  outputLocation?: string;
  bytesScanned?: number;
  completedAt?: string;
  rows: Array<Record<string, string | undefined>>;
};

export class AthenaQueryRunner {
  private readonly client: AthenaClient;
  private readonly pollSeconds: number;
  private readonly timeoutSeconds: number;

  constructor(options: AthenaQueryRunnerOptions = {}) {
    this.client =
      options.client ??
      new AthenaClient({
        region: options.region ?? process.env.AWS_REGION ?? "ap-southeast-2",
      });
    this.pollSeconds = options.pollSeconds ?? 2;
    this.timeoutSeconds = options.timeoutSeconds ?? 120;
  }

  async run(input: AthenaQueryInput): Promise<AthenaQueryResult> {
    const started = await this.client.send(
      new StartQueryExecutionCommand({
        QueryString: input.query,
        QueryExecutionContext: {
          Database: input.database,
        },
        WorkGroup: input.workgroup,
      }),
    );
    const queryExecutionId = started.QueryExecutionId;
    if (!queryExecutionId) {
      throw new Error("Athena did not return a query execution id.");
    }

    const execution = await this.waitForQuery(queryExecutionId);
    const results = await this.client.send(
      new GetQueryResultsCommand({
        QueryExecutionId: queryExecutionId,
      }),
    );

    return {
      queryExecutionId,
      outputLocation:
        execution.QueryExecution?.ResultConfiguration?.OutputLocation,
      bytesScanned: execution.QueryExecution?.Statistics?.DataScannedInBytes,
      completedAt:
        execution.QueryExecution?.Status?.CompletionDateTime?.toISOString(),
      rows: this.parseRows(results.ResultSet?.Rows ?? []),
    };
  }

  private async waitForQuery(queryExecutionId: string) {
    const deadline = Date.now() + this.timeoutSeconds * 1000;

    while (Date.now() <= deadline) {
      const execution = await this.client.send(
        new GetQueryExecutionCommand({
          QueryExecutionId: queryExecutionId,
        }),
      );
      const state = execution.QueryExecution?.Status?.State;

      if (state === "SUCCEEDED") return execution;
      if (state === "FAILED" || state === "CANCELLED") {
        throw new Error(
          `Athena query ${queryExecutionId} ended with ${state}: ${
            execution.QueryExecution?.Status?.StateChangeReason ?? "no reason"
          }`,
        );
      }

      await sleep(this.pollSeconds * 1000);
    }

    await this.stopQueryBestEffort(queryExecutionId);
    throw new Error(
      `Athena query ${queryExecutionId} timed out after ${this.timeoutSeconds} seconds.`,
    );
  }

  private async stopQueryBestEffort(queryExecutionId: string): Promise<void> {
    try {
      await this.client.send(
        new StopQueryExecutionCommand({
          QueryExecutionId: queryExecutionId,
        }),
      );
    } catch {
      // Preserve the timeout error even if cancellation fails.
    }
  }

  private parseRows(rows: Row[]): Array<Record<string, string | undefined>> {
    const header = rows[0]?.Data?.map((cell) => cell.VarCharValue ?? "") ?? [];
    return rows.slice(1).map((row) => {
      const mapped: Record<string, string | undefined> = {};
      row.Data?.forEach((cell, index) => {
        const key = header[index];
        if (key) mapped[key] = cell.VarCharValue;
      });
      return mapped;
    });
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
