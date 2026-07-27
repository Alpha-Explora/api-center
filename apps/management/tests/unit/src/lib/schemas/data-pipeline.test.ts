import { describe, expect, it } from "vitest";
import {
  pipelineHealthResponseSchema,
  pipelineQualityResponseSchema,
} from "../../../../../src/lib/schemas/data-pipeline";

describe("data pipeline source metadata schemas", () => {
  it("preserves Athena source metadata for pipeline health", () => {
    const parsed = pipelineHealthResponseSchema.parse({
      success: true,
      data: [],
      meta: {
        environment: "prod",
        source: "athena-proxy",
        timestamp: "2026-06-25T00:00:00.000Z",
        correlationId: "corr-health",
        sourceMetadata: [
          {
            sourceType: "external",
            sourceName: "pipeline-health-athena",
            durability: "athena",
            evidenceTable: "gold_platform",
            correlationId: "corr-health",
          },
        ],
      },
    });

    expect(parsed.meta.sourceMetadata?.[0]).toMatchObject({
      sourceType: "external",
      sourceName: "pipeline-health-athena",
      durability: "athena",
    });
  });

  it("preserves volatile source metadata for fixture-backed governance", () => {
    const parsed = pipelineQualityResponseSchema.parse({
      success: true,
      data: [],
      meta: {
        environment: "test",
        source: "evidence-file",
        timestamp: "2026-06-25T00:00:00.000Z",
        sourceMetadata: [
          {
            sourceType: "volatile",
            sourceName: "pipeline-governance-evidence-file",
            durability: "none",
            degradedReason: "fixture/local-file backed",
          },
        ],
      },
    });

    expect(parsed.meta.sourceMetadata?.[0]).toMatchObject({
      sourceType: "volatile",
      durability: "none",
    });
  });
});
