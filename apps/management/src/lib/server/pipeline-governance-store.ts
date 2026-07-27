import {
  pipelineAthenaCostRowSchema,
  pipelineGatewayDecisionRowSchema,
  pipelineDecisionSignalRowSchema,
  pipelineHealthEnvironmentSchema,
  pipelineQualityRowSchema,
  pipelineSharedServiceUsageRowSchema,
  type PipelineAthenaCostRow,
  type PipelineGatewayDecisionRow,
  type PipelineDecisionSignalRow,
  type PipelineHealthEnvironment,
  type PipelineQualityRow,
  type PipelineSharedServiceUsageRow,
} from "@/lib/schemas";
import {
  resolvePipelineGovernanceProvider,
  type PipelineGovernanceMetricKind,
  type PipelineGovernanceProvider,
  type PipelineGovernanceResponseSource,
} from "./pipeline-governance-provider";
import type { PipelinePartitionDate } from "./pipeline-health-provider";

type ReadOptions = {
  filePath?: string;
  environment?: PipelineHealthEnvironment;
  partition?: PipelinePartitionDate;
  windowDays?: number;
  provider?: PipelineGovernanceProvider;
};

export async function readPipelineQualityRows(
  options?: ReadOptions,
): Promise<PipelineQualityRow[]> {
  const { rows } = await readRows("quality", options);
  return rows.map((row) => pipelineQualityRowSchema.parse(row));
}

export async function readPipelineQualityResult(options?: ReadOptions) {
  const { rows, source } = await readRows("quality", options);
  return {
    rows: rows.map((row) => pipelineQualityRowSchema.parse(row)),
    source,
  };
}

export async function readPipelineSharedServiceUsageRows(
  options?: ReadOptions,
): Promise<PipelineSharedServiceUsageRow[]> {
  const { rows } = await readRows("shared-service-usage", options);
  return rows.map((row) => pipelineSharedServiceUsageRowSchema.parse(row));
}

export async function readPipelineSharedServiceUsageResult(options?: ReadOptions) {
  const { rows, source } = await readRows("shared-service-usage", options);
  return {
    rows: rows.map((row) => pipelineSharedServiceUsageRowSchema.parse(row)),
    source,
  };
}

export async function readPipelineGatewayDecisionRows(
  options?: ReadOptions,
): Promise<PipelineGatewayDecisionRow[]> {
  const { rows } = await readRows("gateway-decisions", options);
  return rows.map((row) => pipelineGatewayDecisionRowSchema.parse(row));
}

export async function readPipelineGatewayDecisionResult(options?: ReadOptions) {
  const { rows, source } = await readRows("gateway-decisions", options);
  return {
    rows: rows.map((row) => pipelineGatewayDecisionRowSchema.parse(row)),
    source,
  };
}

export async function readPipelineAthenaCostRows(
  options?: ReadOptions,
): Promise<PipelineAthenaCostRow[]> {
  const { rows } = await readRows("cost", options);
  return rows.map((row) => pipelineAthenaCostRowSchema.parse(row));
}

export async function readPipelineAthenaCostResult(options?: ReadOptions) {
  const { rows, source } = await readRows("cost", options);
  return {
    rows: rows.map((row) => pipelineAthenaCostRowSchema.parse(row)),
    source,
  };
}

export async function readPipelineDecisionSignalResult(options?: ReadOptions) {
  const { rows, source } = await readRows("decision-signals", options);
  return {
    rows: rows.map((row) => pipelineDecisionSignalRowSchema.parse(row)),
    source,
  };
}

export async function readPipelineDecisionSignalRows(
  options?: ReadOptions,
): Promise<PipelineDecisionSignalRow[]> {
  const { rows } = await readRows("decision-signals", options);
  return rows.map((row) => pipelineDecisionSignalRowSchema.parse(row));
}

async function readRows(
  kind: PipelineGovernanceMetricKind,
  options?: ReadOptions,
): Promise<{ rows: unknown[]; source: PipelineGovernanceResponseSource }> {
  const environment = pipelineHealthEnvironmentSchema.parse(
    options?.environment ?? "test",
  );
  const provider =
    options?.provider ??
    (await resolvePipelineGovernanceProvider({ filePath: options?.filePath }));
  const result = provider.readResponse
    ? await provider.readResponse(
        kind,
        environment,
        options?.partition,
        options?.windowDays,
      )
    : {
        rows: await provider.readRows(
          kind,
          environment,
          options?.partition,
          options?.windowDays,
        ),
        source: "evidence-file" as const,
      };

  return {
    rows: result.rows.filter(
      (row) =>
        row &&
        typeof row === "object" &&
        "environment" in row &&
        (row as { environment?: unknown }).environment === environment,
    ),
    source: result.source,
  };
}
