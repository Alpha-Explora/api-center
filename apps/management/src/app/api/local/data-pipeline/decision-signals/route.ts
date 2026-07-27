import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  parsePipelinePartitionDate,
  parsePipelineWindowDays,
} from "@/lib/server/pipeline-health-provider";
import { readPipelineDecisionSignalResult } from "@/lib/server/pipeline-governance-store";
import {
  pipelineDecisionSignalResponseSchema,
} from "@/lib/schemas";
import {
  isEnvironmentNameError,
  readPipelineLaneQuery,
} from "@/lib/environment-names";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const pipelineLane = readPipelineLaneQuery(searchParams);
    const partition = parsePipelinePartitionDate(searchParams);
    const windowDays = parsePipelineWindowDays(searchParams);
    const result = await readPipelineDecisionSignalResult({
      environment: pipelineLane,
      partition,
      windowDays,
    });
    const body = pipelineDecisionSignalResponseSchema.parse({
      success: true,
      data: result.rows,
      meta: {
        environment: pipelineLane,
        pipelineLane,
        partition,
        windowDays,
        source: result.source,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json(body);
  } catch (error) {
    return pipelineDecisionSignalErrorResponse(
      error,
      "Pipeline decision signal lookup failed.",
    );
  }
}

function pipelineDecisionSignalErrorResponse(error: unknown, fallback: string) {
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

  return NextResponse.json(
    {
      success: false,
      error: error instanceof Error ? error.message : fallback,
    },
    { status: 500 },
  );
}
