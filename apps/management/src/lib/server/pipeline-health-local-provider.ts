import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  PipelineHealthProvider,
  PipelinePartitionDate,
} from "./pipeline-health-provider";

const storeSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
});

export class LocalFilePipelineHealthProvider implements PipelineHealthProvider {
  private readonly filePath?: string;

  constructor(options?: { filePath?: string }) {
    this.filePath = options?.filePath;
  }

  async readRows(
    environment?: string,
    partition?: PipelinePartitionDate,
  ): Promise<unknown[]> {
    void [environment, partition];
    const filePath = resolvePipelineHealthFile(this.filePath);

    try {
      const raw = await readFile(filePath, "utf8");
      return storeSchema.parse(JSON.parse(raw)).rows;
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  }
}

function resolvePipelineHealthFile(filePath: string | undefined) {
  if (process.env.NODE_ENV !== "production") {
    return (
      filePath ??
      process.env.PIPELINE_HEALTH_EVIDENCE_FILE ??
      ".local-state/pipeline-health.json"
    );
  }

  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    ".local-state",
    "pipeline-health.json",
  );
}

function isMissingFileError(error: unknown) {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
