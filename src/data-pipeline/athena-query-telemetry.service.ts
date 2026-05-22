import { Inject, Injectable, Optional } from "@nestjs/common";
import { PipelineHealthEnvironment } from "./pipeline-health.dto";

export const ATHENA_QUERY_TELEMETRY_OPTIONS =
  "ATHENA_QUERY_TELEMETRY_OPTIONS";

export const ATHENA_QUERY_TELEMETRY_TOPIC_SUFFIX =
  "api-center.pipeline.athena-query-execution";

export type AthenaQueryTelemetryPublisher = {
  publish(
    topic: string,
    payload: Record<string, unknown>,
    key?: string,
  ): Promise<void> | void;
};

export type AthenaQueryTelemetryOptions = {
  publisher?: AthenaQueryTelemetryPublisher;
  now?: () => Date;
};

export type AthenaQueryTelemetryInput = {
  environment: PipelineHealthEnvironment;
  database: string;
  workgroup: string;
  resultPurpose: string;
  queryExecutionId: string;
  bytesScanned?: number;
  outputLocation?: string;
  completedAt?: string;
};

@Injectable()
export class AthenaQueryTelemetryService {
  constructor(
    @Optional()
    @Inject(ATHENA_QUERY_TELEMETRY_OPTIONS)
    private readonly options: AthenaQueryTelemetryOptions = {},
  ) {}

  async emitQueryCompleted(input: AthenaQueryTelemetryInput): Promise<void> {
    const publisher = this.options.publisher;
    if (!publisher) return;

    const completedAt =
      input.completedAt ??
      this.options.now?.().toISOString() ??
      new Date().toISOString();

    try {
      await publisher.publish(
        `${input.environment}.${ATHENA_QUERY_TELEMETRY_TOPIC_SUFFIX}`,
        {
          eventType: "athena.query.completed",
          metadata: {
            schemaVersion: "1.0.0",
          },
          payload: {
            environment: input.environment,
            database: input.database,
            workgroup: input.workgroup,
            resultPurpose: input.resultPurpose,
            queryExecutionId: input.queryExecutionId,
            bytesScanned: input.bytesScanned ?? 0,
            outputLocation: input.outputLocation,
            completedAt,
          },
        },
        input.workgroup,
      );
    } catch {
      // Telemetry must never break the dashboard read path.
    }
  }
}
