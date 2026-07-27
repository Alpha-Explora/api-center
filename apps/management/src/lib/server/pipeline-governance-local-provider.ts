import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  PipelineGovernanceMetricKind,
  PipelineGovernanceProvider,
  PipelineGovernanceReadResult,
} from "./pipeline-governance-provider";
import type { PipelinePartitionDate } from "./pipeline-health-provider";

const storeSchema = z.object({
  qualityRows: z.array(z.record(z.string(), z.unknown())).default([]),
  sharedServiceUsageRows: z.array(z.record(z.string(), z.unknown())).default([]),
  gatewayDecisionRows: z.array(z.record(z.string(), z.unknown())).default([]),
  costRows: z.array(z.record(z.string(), z.unknown())).default([]),
  decisionSignalRows: z.array(z.record(z.string(), z.unknown())).default([]),
});

export class LocalFilePipelineGovernanceProvider
  implements PipelineGovernanceProvider
{
  private readonly filePath?: string;

  constructor(options?: { filePath?: string }) {
    this.filePath = options?.filePath;
  }

  async readRows(kind: PipelineGovernanceMetricKind): Promise<unknown[]> {
    return (await this.readResponse(kind)).rows;
  }

  async readResponse(
    kind: PipelineGovernanceMetricKind,
    environment?: string,
    partition?: PipelinePartitionDate,
  ): Promise<PipelineGovernanceReadResult> {
    void [environment, partition];
    const filePath = resolvePipelineGovernanceFile(this.filePath);

    try {
      const raw = await readFile(filePath, "utf8");
      const store = storeSchema.parse(JSON.parse(raw));
      const rows =
        kind === "quality"
          ? store.qualityRows
          : kind === "shared-service-usage"
            ? store.sharedServiceUsageRows
            : kind === "gateway-decisions"
              ? store.gatewayDecisionRows
              : kind === "cost"
                ? store.costRows
                : store.decisionSignalRows;
      return { rows, source: "evidence-file" };
    } catch (error) {
      if (isMissingFileError(error)) return { rows: [], source: "evidence-file" };
      throw error;
    }
  }
}

function resolvePipelineGovernanceFile(filePath: string | undefined) {
  if (process.env.NODE_ENV !== "production") {
    return (
      filePath ??
      process.env.PIPELINE_GOVERNANCE_EVIDENCE_FILE ??
      ".local-state/pipeline-governance.json"
    );
  }

  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    ".local-state",
    "pipeline-governance.json",
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
