import { NextResponse } from "next/server";
import { platformAdministratorResponse } from "@/lib/server/organization-access";
import { ZodError } from "zod";
import {
  parsePipelinePartitionDate,
  parsePipelineWindowDays,
} from "@/lib/server/pipeline-health-provider";
import { readPipelineAthenaCostResult } from "@/lib/server/pipeline-governance-store";
import {
  pipelineAthenaCostResponseSchema,
} from "@/lib/schemas";
import {
  isEnvironmentNameError,
  readPipelineLaneQuery,
} from "@/lib/environment-names";

export async function GET(request: Request) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  try {
    const searchParams = new URL(request.url).searchParams;
    const pipelineLane = readPipelineLaneQuery(searchParams);
    const partition = parsePipelinePartitionDate(searchParams);
    const windowDays = parsePipelineWindowDays(searchParams);
    const result = await readPipelineAthenaCostResult({
      environment: pipelineLane,
      partition,
      windowDays,
    });
    const body = pipelineAthenaCostResponseSchema.parse({
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
    return pipelineGovernanceErrorResponse(error, "Pipeline cost lookup failed.");
  }
}

function pipelineGovernanceErrorResponse(error: unknown, fallback: string) {
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
