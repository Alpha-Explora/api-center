import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiCenterPipelineGovernanceProvider,
  resolvePipelineGovernanceProvider,
} from "../../../../../src/lib/server/pipeline-governance-provider";
import { LocalFilePipelineGovernanceProvider } from "../../../../../src/lib/server/pipeline-governance-local-provider";

describe("pipeline governance provider", () => {
  const originalGovernanceProvider = process.env.PIPELINE_GOVERNANCE_PROVIDER;
  const originalHealthProvider = process.env.PIPELINE_HEALTH_PROVIDER;
  const originalEvidenceFile = process.env.PIPELINE_GOVERNANCE_EVIDENCE_FILE;
  const originalSecret = process.env.API_CENTER_PLATFORM_ADMIN_SECRET;

  afterEach(() => {
    restoreEnv("PIPELINE_GOVERNANCE_PROVIDER", originalGovernanceProvider);
    restoreEnv("PIPELINE_HEALTH_PROVIDER", originalHealthProvider);
    restoreEnv("PIPELINE_GOVERNANCE_EVIDENCE_FILE", originalEvidenceFile);
    restoreEnv("API_CENTER_PLATFORM_ADMIN_SECRET", originalSecret);
  });

  it("reads rows from the local governance evidence file", async () => {
    const filePath = await writeEvidenceFile();
    const provider = new LocalFilePipelineGovernanceProvider({ filePath });

    await expect(provider.readResponse("quality", "test")).resolves.toEqual({
      rows: [
        expect.objectContaining({
          environment: "test",
          tribeId: "logistics",
        }),
      ],
      source: "evidence-file",
    });
  });

  it("defaults to api-center when a platform admin secret is configured", async () => {
    delete process.env.PIPELINE_GOVERNANCE_PROVIDER;
    delete process.env.PIPELINE_HEALTH_PROVIDER;
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET = "server-secret";

    await expect(resolvePipelineGovernanceProvider()).resolves.toBeInstanceOf(
      ApiCenterPipelineGovernanceProvider,
    );
  });

  it("does not resolve the default local evidence path from process.cwd", async () => {
    delete process.env.PIPELINE_GOVERNANCE_EVIDENCE_FILE;
    const cwdSpy = vi.spyOn(process, "cwd").mockImplementation(() => {
      throw new Error("process.cwd should not be called for default evidence path");
    });

    try {
      const provider = new LocalFilePipelineGovernanceProvider();

      await expect(provider.readResponse("quality", "test")).resolves.toEqual({
        rows: [],
        source: "evidence-file",
      });
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("preserves the upstream APICenter response source", async () => {
    const provider = new ApiCenterPipelineGovernanceProvider({
      baseUrl: "https://api-center.test",
      platformSecret: "server-secret",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                environment: "test",
                tribeId: "logistics",
                eventType: "order.created",
                eventDay: "2026-05-20",
                eventCount: 1000,
                validEventCount: 1000,
                invalidEventCount: 0,
                qualityErrorCount: 0,
              },
            ],
            meta: {
              environment: "test",
              source: "evidence-file",
              timestamp: "2026-05-20T15:30:00.000Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    await expect(provider.readResponse("quality", "test")).resolves.toEqual({
      rows: [expect.objectContaining({ tribeId: "logistics" })],
      source: "evidence-file",
    });
  });

  it("passes partition and window parameters to the APICenter provider", async () => {
    const fetchCalls: string[] = [];
    const provider = new ApiCenterPipelineGovernanceProvider({
      baseUrl: "https://api-center.test",
      platformSecret: "server-secret",
      fetchImpl: async (input) => {
        fetchCalls.push(String(input));
        return new Response(
          JSON.stringify({
            success: true,
            data: [],
            meta: {
              environment: "prod",
              source: "athena-proxy",
              partition: { year: "2026", month: "05", day: "20" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await provider.readResponse(
      "quality",
      "prod",
      {
        year: "2026",
        month: "05",
        day: "20",
      },
      30,
    );

    expect(fetchCalls[0]).toBe(
      "https://api-center.test/api/v1/data-pipeline/quality?environment=prod&year=2026&month=05&day=20&windowDays=30",
    );
  });
});

async function writeEvidenceFile() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pipeline-governance-provider-"));
  const filePath = path.join(dir, "pipeline-governance.json");
  await writeFile(
    filePath,
    JSON.stringify({
      qualityRows: [
        {
          environment: "test",
          tribeId: "logistics",
          eventType: "order.created",
          eventDay: "2026-05-20",
          eventCount: 1000,
          validEventCount: 1000,
          invalidEventCount: 0,
          qualityErrorCount: 0,
        },
      ],
    }),
    "utf8",
  );
  return filePath;
}

function restoreEnv(name: string, value: string | undefined) {
  if (value) {
    process.env[name] = value;
  } else {
    delete process.env[name];
  }
}
