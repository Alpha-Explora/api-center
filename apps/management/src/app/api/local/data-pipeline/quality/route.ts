import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  parsePipelinePartitionDate,
  parsePipelineWindowDays,
} from "@/lib/server/pipeline-health-provider";
import { readPipelineQualityResult } from "@/lib/server/pipeline-governance-store";
import { resolvePipelineGovernanceResponseSource } from "@/lib/server/pipeline-governance-provider";
import {
  pipelineQualityResponseSchema,
} from "@/lib/schemas";
import {
  isEnvironmentNameError,
  readPipelineLaneQuery,
} from "@/lib/environment-names";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  let pipelineLane: "test" | "prod" = "test";
  let windowDays: number | undefined;

  try {
    pipelineLane = readPipelineLaneQuery(searchParams);
    const partition = parsePipelinePartitionDate(searchParams);
    windowDays = parsePipelineWindowDays(searchParams);
    const result = await readPipelineQualityResult({
      environment: pipelineLane,
      partition,
      windowDays,
    });
    const body = pipelineQualityResponseSchema.parse({
      success: true,
      data: result.rows,
      meta: {
        environment: pipelineLane,
        pipelineLane,
        partition,
        windowDays,
        source: result.source,
        timestamp: new Date().toISOString(),
        sourceMetadata: [sourceMetadataForPipelineGovernance(result.source)],
      },
    });

    return NextResponse.json(body);
  } catch (error) {
    return pipelineGovernanceErrorResponse({ error, pipelineLane, windowDays });
  }
}

function pipelineGovernanceErrorResponse({
  error,
  pipelineLane,
  windowDays,
}: {
  error: unknown;
  pipelineLane: "test" | "prod";
  windowDays?: number;
}) {
  if (error instanceof ZodError || isEnvironmentNameError(error)) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof ZodError
            ? (error.issues[0]?.message ?? "Invalid request.")
            : error.message,
      },
      { status: 400 },
    );
  }

  const source = resolvePipelineGovernanceResponseSource();
  const reason =
    error instanceof Error ? error.message : "Pipeline quality lookup failed.";
  return NextResponse.json(
    {
      success: false,
      error: reason,
      meta: {
        environment: pipelineLane,
        pipelineLane,
        windowDays,
        source,
        timestamp: new Date().toISOString(),
        sourceMetadata: [
          {
            ...sourceMetadataForPipelineGovernance(source),
            sourceType: "unavailable" as const,
            durability: "none" as const,
            degradedReason: reason,
          },
        ],
      },
    },
    { status: 500 },
  );
}

function sourceMetadataForPipelineGovernance(source: "evidence-file" | "athena-proxy") {
  if (source === "athena-proxy") {
    return {
      sourceType: "external" as const,
      sourceName: "pipeline-governance-athena",
      durability: "athena" as const,
      evidenceTable: "gold_platform.pipeline_quality",
    };
  }

  return {
    sourceType: "volatile" as const,
    sourceName: "pipeline-governance-evidence-file",
    durability: "none" as const,
    degradedReason: "local evidence file",
  };
}
