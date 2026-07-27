import {
  filterPipelineHealthRows,
  normalizePipelineHealthRows,
} from "@/lib/pipeline-health";
import {
  pipelineHealthEnvironmentSchema,
  type PipelineHealthEnvironment,
} from "@/lib/schemas";
import {
  resolvePipelineHealthProvider,
  type PipelinePartitionDate,
  type PipelineHealthProvider,
} from "./pipeline-health-provider";

export async function readPipelineHealthRows(options?: {
  filePath?: string;
  environment?: PipelineHealthEnvironment;
  partition?: PipelinePartitionDate;
  provider?: PipelineHealthProvider;
}) {
  const environment = pipelineHealthEnvironmentSchema.parse(
    options?.environment ?? "test",
  );
  const provider =
    options?.provider ??
    (await resolvePipelineHealthProvider({ filePath: options?.filePath }));
  const rows = await provider.readRows(environment, options?.partition);
  return filterPipelineHealthRows(
    normalizePipelineHealthRows(rows),
    environment,
  );
}
