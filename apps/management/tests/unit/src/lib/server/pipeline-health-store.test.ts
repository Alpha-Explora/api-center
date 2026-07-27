import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { readPipelineHealthRows } from "../../../../../src/lib/server/pipeline-health-store";

describe("pipeline health store", () => {
  it("reads and filters test pilot evidence rows", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pipeline-health-"));
    const filePath = path.join(dir, "pipeline-health.json");
    await writeFile(
      filePath,
      JSON.stringify({
        rows: [
          {
            environment: "test",
            tribe_id: "codex-sdk-20260520041053",
            source_service_id: "codex-sdk-20260520041053-api",
            event_type: "codex.pipeline.flush",
            event_day: "2026-05-20",
            event_count: 1000,
            latest_occurred_at: "2026-05-20T09:41:45.721Z",
            latest_ingested_at: "2026-05-20T09:42:00.000Z",
          },
          {
            environment: "prod",
            tribe_id: "payments",
            source_service_id: "payments-api",
            event_type: "payment.completed",
            event_day: "2026-05-20",
            event_count: 2,
          },
        ],
      }),
      "utf8",
    );

    const rows = await readPipelineHealthRows({
      filePath,
      environment: "test",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tribeId).toBe("codex-sdk-20260520041053");
  });

  it("returns an empty array when the evidence file is missing", async () => {
    const rows = await readPipelineHealthRows({
      filePath: path.join(os.tmpdir(), "missing-pipeline-health.json"),
      environment: "test",
    });

    expect(rows).toEqual([]);
  });
});
