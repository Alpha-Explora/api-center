import { NextResponse } from "next/server";
import { platformAdministratorResponse } from "@/lib/server/organization-access";
import { ZodError } from "zod";
import {
  parsePipelinePartitionDate,
  resolvePipelineHealthResponseSource,
} from "@/lib/server/pipeline-health-provider";
import { readPipelineHealthRows } from "@/lib/server/pipeline-health-store";
import { pipelineHealthResponseSchema } from "@/lib/schemas";
import {
  isEnvironmentNameError,
  readPipelineLaneQuery,
} from "@/lib/environment-names";

export async function GET(request: Request) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  const searchParams = new URL(request.url).searchParams;
  let pipelineLane: "test" | "prod" = "test";

  try {
    pipelineLane = readPipelineLaneQuery(searchParams);
    const partition = parsePipelinePartitionDate(searchParams);
    const rows = await readPipelineHealthRows({
      environment: pipelineLane,
      partition,
    });
    const source = resolvePipelineHealthResponseSource();
    const body = pipelineHealthResponseSchema.parse({
      success: true,
      data: rows,
      meta: {
        environment: pipelineLane,
        pipelineLane,
        partition,
        source,
        timestamp: new Date().toISOString(),
        sourceMetadata: [sourceMetadataForPipelineHealth(source)],
      },
    });

    return NextResponse.json(body);
  } catch (error) {
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

    const source = resolvePipelineHealthResponseSource();
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Pipeline health lookup failed.",
        meta: {
          environment: pipelineLane,
          pipelineLane,
          source,
          timestamp: new Date().toISOString(),
          sourceMetadata: [
            {
              ...sourceMetadataForPipelineHealth(source),
              sourceType: "unavailable" as const,
              durability: "none" as const,
              degradedReason:
                error instanceof Error
                  ? error.message
                  : "Pipeline health lookup failed.",
            },
          ],
        },
      },
      { status: 500 },
    );
  }
}

function sourceMetadataForPipelineHealth(source: "evidence-file" | "athena-proxy") {
  if (source === "athena-proxy") {
    return {
      sourceType: "external" as const,
      sourceName: "pipeline-health-athena",
      durability: "athena" as const,
      evidenceTable: "gold_platform.pipeline_health",
    };
  }

  return {
    sourceType: "volatile" as const,
    sourceName: "pipeline-health-evidence-file",
    durability: "none" as const,
    degradedReason: "local evidence file",
  };
}
