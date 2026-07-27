import {
  pipelineAthenaCostResponseSchema,
  pipelineDecisionSignalResponseSchema,
  pipelineFeedbackActionRequestSchema,
  pipelineFeedbackActionResponseSchema,
  pipelineGatewayDecisionResponseSchema,
  pipelineHealthResponseSchema,
  pipelineQualityResponseSchema,
  pipelineSharedServiceUsageResponseSchema,
  rawToSilverRunRequestSchema,
  rawToSilverRunResponseSchema,
  type PipelineAthenaCostRow,
  type PipelineDecisionSignalRow,
  type PipelineFeedbackActionRequest,
  type PipelineFeedbackRecord,
  type PipelineGatewayDecisionRow,
  type PipelineHealthEnvironment,
  type PipelineHealthRow,
  type PipelinePartitionDate,
  type PipelineQualityRow,
  type PipelineSharedServiceUsageRow,
  type RawToSilverRunRequest,
  type RawToSilverRunResult,
} from "@/lib/schemas";
import { request } from "@/lib/api-center/client-core";

export async function getDataPipelineHealth(
  environment: PipelineHealthEnvironment = "test",
  partition?: PipelinePartitionDate,
): Promise<PipelineHealthRow[]> {
  const data = await request<unknown>(
    `/api/local/data-pipeline/health?${dataPipelineParams(
      environment,
      partition,
    )}`,
  );

  return pipelineHealthResponseSchema.parse(data).data;
}

export async function getDataPipelineQuality(
  environment: PipelineHealthEnvironment = "test",
  partition?: PipelinePartitionDate,
  windowDays?: number,
): Promise<PipelineQualityRow[]> {
  const data = await request<unknown>(
    `/api/local/data-pipeline/quality?${dataPipelineParams(
      environment,
      partition,
      windowDays,
    )}`,
  );

  return pipelineQualityResponseSchema.parse(data).data;
}

export async function getDataPipelineSharedServiceUsage(
  environment: PipelineHealthEnvironment = "test",
  partition?: PipelinePartitionDate,
  windowDays?: number,
): Promise<PipelineSharedServiceUsageRow[]> {
  const data = await request<unknown>(
    `/api/local/data-pipeline/shared-service-usage?${dataPipelineParams(
      environment,
      partition,
      windowDays,
    )}`,
  );

  return pipelineSharedServiceUsageResponseSchema.parse(data).data;
}

export async function getDataPipelineGatewayDecisions(
  environment: PipelineHealthEnvironment = "test",
  partition?: PipelinePartitionDate,
  windowDays?: number,
): Promise<PipelineGatewayDecisionRow[]> {
  const data = await request<unknown>(
    `/api/local/data-pipeline/gateway-decisions?${dataPipelineParams(
      environment,
      partition,
      windowDays,
    )}`,
  );

  return pipelineGatewayDecisionResponseSchema.parse(data).data;
}

export async function getDataPipelineCost(
  environment: PipelineHealthEnvironment = "test",
  partition?: PipelinePartitionDate,
  windowDays?: number,
): Promise<PipelineAthenaCostRow[]> {
  const data = await request<unknown>(
    `/api/local/data-pipeline/cost?${dataPipelineParams(
      environment,
      partition,
      windowDays,
    )}`,
  );

  return pipelineAthenaCostResponseSchema.parse(data).data;
}

export async function getDataPipelineDecisionSignals(
  environment: PipelineHealthEnvironment = "test",
  partition?: PipelinePartitionDate,
  windowDays?: number,
): Promise<PipelineDecisionSignalRow[]> {
  const data = await request<unknown>(
    `/api/local/data-pipeline/decision-signals?${dataPipelineParams(
      environment,
      partition,
      windowDays,
    )}`,
  );

  return pipelineDecisionSignalResponseSchema.parse(data).data;
}

export async function previewRawToSilverRun(
  input: RawToSilverRunRequest,
): Promise<RawToSilverRunResult> {
  const payload = rawToSilverRunRequestSchema.parse({
    ...input,
    preview: true,
  });
  const data = await request<unknown>(
    "/api/local/data-pipeline/raw-to-silver-runs",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  return rawToSilverRunResponseSchema.parse(data).data;
}

export async function startRawToSilverRun(
  input: RawToSilverRunRequest,
): Promise<RawToSilverRunResult> {
  const payload = rawToSilverRunRequestSchema.parse({
    ...input,
    preview: false,
  });
  const data = await request<unknown>(
    "/api/local/data-pipeline/raw-to-silver-runs",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  return rawToSilverRunResponseSchema.parse(data).data;
}

export async function createPipelineFeedbackAction(
  input: PipelineFeedbackActionRequest,
): Promise<PipelineFeedbackRecord> {
  const payload = pipelineFeedbackActionRequestSchema.parse(input);
  const data = await request<unknown>(
    "/api/local/data-pipeline/feedback-actions",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  return pipelineFeedbackActionResponseSchema.parse(data).data;
}

function dataPipelineParams(
  environment: PipelineHealthEnvironment,
  partition?: PipelinePartitionDate,
  windowDays?: number,
) {
  const params = new URLSearchParams({ pipelineLane: environment });
  if (partition) {
    params.set("year", partition.year);
    params.set("month", partition.month);
    params.set("day", partition.day);
  }
  if (windowDays) {
    params.set("windowDays", String(windowDays));
  }
  return params.toString();
}
