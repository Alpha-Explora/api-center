import { Inject, Injectable, Optional } from "@nestjs/common";
import { ValidationError } from "../shared/errors";
import { AthenaQueryRunner, AthenaQueryResult } from "./athena-query-runner";
import {
  PipelineHealthEnvironment,
  PipelinePartitionDate,
} from "./pipeline-health.dto";
import {
  pipelinePhysicalTopicForTribe,
  toPhysicalPipelineEnvironment,
} from "./pipeline-environment";

type PipelineAthenaRunner = Pick<AthenaQueryRunner, "run">;

export interface RawToSilverRunServiceOptions {
  athenaRunner?: PipelineAthenaRunner;
  rawDatabase?: string;
  bronzeDatabase?: string;
  commonSilverDatabase?: string;
  materializedDatabase?: string;
  curatedBucket?: string;
  validationWorkgroup?: string;
  materializationWorkgroup?: string;
  now?: () => Date;
}

export interface RawToSilverRunInput {
  environment: PipelineHealthEnvironment;
  tribeId: string;
  partition: PipelinePartitionDate;
  materialize?: boolean;
  preview?: boolean;
}

export interface RawToSilverRunStage {
  rowCount?: number;
  queryExecutionId?: string;
  outputLocation?: string;
  bytesScanned?: number;
  completedAt?: string;
}

export interface RawToSilverRunResult {
  status: "preview" | "completed" | "blocked";
  blockedReason?: string;
  environment: PipelineHealthEnvironment;
  tribeId: string;
  physicalTopic: string;
  partition: PipelinePartitionDate;
  startedAt: string;
  completedAt?: string;
  raw: RawToSilverRunStage;
  bronze: RawToSilverRunStage;
  commonSilver: RawToSilverRunStage;
  materialization?: {
    requested: boolean;
    targetDatabase: string;
    targetTable: string;
    externalLocation: string;
    queryExecutionId?: string;
    outputLocation?: string;
    completedAt?: string;
  };
  previewQueries: {
    raw: string;
    bronze: string;
    commonSilver: string;
    createMaterializedDatabase?: string;
    materialize?: string;
  };
}

export const RAW_TO_SILVER_RUN_SERVICE_OPTIONS =
  "RAW_TO_SILVER_RUN_SERVICE_OPTIONS";

@Injectable()
export class RawToSilverRunService {
  constructor(
    @Optional()
    @Inject(RAW_TO_SILVER_RUN_SERVICE_OPTIONS)
    private readonly options: RawToSilverRunServiceOptions = {},
  ) {}

  async startRun(input: RawToSilverRunInput): Promise<RawToSilverRunResult> {
    const tribeId = this.normalizeTribeId(input.tribeId);
    const physicalTopic = pipelinePhysicalTopicForTribe(input.environment, tribeId);
    const startedAt = this.now().toISOString();
    const materialization = this.buildMaterialization(
      input.environment,
      tribeId,
      input.partition,
      Boolean(input.materialize),
    );
    const previewQueries = {
      raw: this.buildRawQuery(physicalTopic, input.partition),
      bronze: this.buildBronzeQuery(
        input.environment,
        tribeId,
        physicalTopic,
        input.partition,
      ),
      commonSilver: this.buildCommonSilverQuery(
        input.environment,
        tribeId,
        physicalTopic,
        input.partition,
      ),
      createMaterializedDatabase: input.materialize
        ? `CREATE DATABASE IF NOT EXISTS ${this.materializedDatabase()}`
        : undefined,
      materialize: input.materialize
        ? this.buildMaterializationQuery(
            input.environment,
            tribeId,
            input.partition,
            materialization.externalLocation,
          )
        : undefined,
    };

    if (input.preview) {
      return {
        status: "preview",
        environment: input.environment,
        tribeId,
        physicalTopic,
        partition: input.partition,
        startedAt,
        raw: {},
        bronze: {},
        commonSilver: {},
        materialization,
        previewQueries,
      };
    }

    const validationWorkgroup = this.validationWorkgroup(input.environment);
    const raw = stageFromResult(
      await this.runner().run({
        query: previewQueries.raw,
        database: this.rawDatabase(),
        workgroup: validationWorkgroup,
      }),
    );
    const bronze = stageFromResult(
      await this.runner().run({
        query: previewQueries.bronze,
        database: this.bronzeDatabase(),
        workgroup: validationWorkgroup,
      }),
    );
    const commonSilver = stageFromResult(
      await this.runner().run({
        query: previewQueries.commonSilver,
        database: this.commonSilverDatabase(),
        workgroup: validationWorkgroup,
      }),
    );
    const result: RawToSilverRunResult = {
      status: "completed",
      environment: input.environment,
      tribeId,
      physicalTopic,
      partition: input.partition,
      startedAt,
      completedAt: this.now().toISOString(),
      raw,
      bronze,
      commonSilver,
      materialization,
      previewQueries,
    };

    if (input.materialize && (commonSilver.rowCount ?? 0) <= 0) {
      return {
        ...result,
        status: "blocked",
        blockedReason: "Common Silver returned zero rows.",
      };
    }

    if (input.materialize && previewQueries.createMaterializedDatabase) {
      await this.runner().run({
        query: previewQueries.createMaterializedDatabase,
        database: this.materializedDatabase(),
        workgroup: this.materializationWorkgroup(input.environment),
      });
      const materialized = await this.runner().run({
        query: previewQueries.materialize ?? "",
        database: this.materializedDatabase(),
        workgroup: this.materializationWorkgroup(input.environment),
      });
      result.materialization = {
        ...materialization,
        queryExecutionId: materialized.queryExecutionId,
        outputLocation: materialized.outputLocation,
        completedAt: materialized.completedAt,
      };
    }

    return result;
  }

  private buildRawQuery(topic: string, partition: PipelinePartitionDate) {
    return `
SELECT COUNT(*) AS row_count
FROM api_center_raw.topic_records
WHERE physical_topic = '${topic}'
  AND year = '${partition.year}'
  AND month = '${partition.month}'
  AND day = '${partition.day}'
`.trim();
  }

  private buildBronzeQuery(
    environment: PipelineHealthEnvironment,
    tribeId: string,
    topic: string,
    partition: PipelinePartitionDate,
  ) {
    return `
SELECT COUNT(*) AS row_count
FROM bronze.tribe_events
WHERE environment = '${toPhysicalPipelineEnvironment(environment)}'
  AND tribe_id = '${tribeId}'
  AND source_topic = '${topic}'
  AND year = '${partition.year}'
  AND month = '${partition.month}'
  AND day = '${partition.day}'
`.trim();
  }

  private buildCommonSilverQuery(
    environment: PipelineHealthEnvironment,
    tribeId: string,
    topic: string,
    partition: PipelinePartitionDate,
  ) {
    return `
SELECT COUNT(*) AS row_count
FROM common_silver.tribe_event_envelope
WHERE environment = '${toPhysicalPipelineEnvironment(environment)}'
  AND tribe_id = '${tribeId}'
  AND source_topic = '${topic}'
  AND year = '${partition.year}'
  AND month = '${partition.month}'
  AND day = '${partition.day}'
`.trim();
  }

  private buildMaterializationQuery(
    environment: PipelineHealthEnvironment,
    tribeId: string,
    partition: PipelinePartitionDate,
    externalLocation: string,
  ) {
    const targetTable = this.targetTable(tribeId, environment, partition);
    return `
CREATE TABLE ${this.materializedDatabase()}.${targetTable}
WITH (
  format = 'PARQUET',
  parquet_compression = 'SNAPPY',
  external_location = '${externalLocation}'
) AS
SELECT *
FROM common_silver.tribe_event_envelope
WHERE environment = '${toPhysicalPipelineEnvironment(environment)}'
  AND tribe_id = '${tribeId}'
  AND year = '${partition.year}'
  AND month = '${partition.month}'
  AND day = '${partition.day}'
`.trim();
  }

  private buildMaterialization(
    environment: PipelineHealthEnvironment,
    tribeId: string,
    partition: PipelinePartitionDate,
    requested: boolean,
  ) {
    return {
      requested,
      targetDatabase: this.materializedDatabase(),
      targetTable: `${this.materializedDatabase()}.${this.targetTable(
        tribeId,
        environment,
        partition,
      )}`,
      externalLocation:
        `s3://${this.curatedBucket()}/silver/common_silver/tribe_event_envelope/` +
        `tribe_id=${tribeId}/environment=${environment}/year=${partition.year}/` +
        `month=${partition.month}/day=${partition.day}/`,
    };
  }

  private targetTable(
    tribeId: string,
    environment: PipelineHealthEnvironment,
    partition: PipelinePartitionDate,
  ) {
    const safeTribe = tribeId.replace(/[^a-z0-9_]/g, "_");
    return `common_silver_tribe_event_envelope_${safeTribe}_${environment}_${partition.year}${partition.month}${partition.day}`;
  }

  private normalizeTribeId(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(normalized)) {
      throw new ValidationError(
        "tribeId must use lowercase letters, numbers, dot, underscore, or hyphen.",
      );
    }
    return normalized;
  }

  private runner(): PipelineAthenaRunner {
    return this.options.athenaRunner ?? new AthenaQueryRunner();
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private rawDatabase(): string {
    return this.options.rawDatabase ?? "api_center_raw";
  }

  private bronzeDatabase(): string {
    return this.options.bronzeDatabase ?? "bronze";
  }

  private commonSilverDatabase(): string {
    return this.options.commonSilverDatabase ?? "common_silver";
  }

  private materializedDatabase(): string {
    return (
      this.options.materializedDatabase ??
      process.env.PIPELINE_MATERIALIZED_DATABASE ??
      "materialized_platform"
    );
  }

  private curatedBucket(): string {
    return (
      this.options.curatedBucket ??
      process.env.API_CENTER_CURATED_BUCKET ??
      "api-center-curated-data"
    );
  }

  private validationWorkgroup(environment: PipelineHealthEnvironment): string {
    return (
      this.options.validationWorkgroup ??
      process.env.PIPELINE_VALIDATION_ATHENA_WORKGROUP ??
      `api-center-platform-validation-${toPhysicalPipelineEnvironment(environment)}`
    );
  }

  private materializationWorkgroup(
    environment: PipelineHealthEnvironment,
  ): string {
    return (
      this.options.materializationWorkgroup ??
      process.env.PIPELINE_MATERIALIZATION_ATHENA_WORKGROUP ??
      `api-center-materialization-${toPhysicalPipelineEnvironment(environment)}`
    );
  }
}

function stageFromResult(result: AthenaQueryResult): RawToSilverRunStage {
  return {
    rowCount: readRowCount(result),
    queryExecutionId: result.queryExecutionId,
    outputLocation: result.outputLocation,
    bytesScanned: result.bytesScanned,
    completedAt: result.completedAt,
  };
}

function readRowCount(result: AthenaQueryResult): number {
  const value = result.rows[0]?.row_count ?? result.rows[0]?.count;
  if (typeof value !== "string") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
