import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiCenterPipelineHealthProvider,
  resolvePipelineHealthProvider,
} from "../../../../../src/lib/server/pipeline-health-provider";
import { LocalFilePipelineHealthProvider } from "../../../../../src/lib/server/pipeline-health-local-provider";

describe("pipeline health provider", () => {
  const originalProvider = process.env.PIPELINE_HEALTH_PROVIDER;
  const originalEvidenceFile = process.env.PIPELINE_HEALTH_EVIDENCE_FILE;
  const originalBaseUrl = process.env.API_CENTER_BASE_URL;
  const originalSecret = process.env.API_CENTER_PLATFORM_ADMIN_SECRET;

  afterEach(() => {
    if (originalProvider) {
      process.env.PIPELINE_HEALTH_PROVIDER = originalProvider;
    } else {
      delete process.env.PIPELINE_HEALTH_PROVIDER;
    }

    if (originalEvidenceFile) {
      process.env.PIPELINE_HEALTH_EVIDENCE_FILE = originalEvidenceFile;
    } else {
      delete process.env.PIPELINE_HEALTH_EVIDENCE_FILE;
    }

    if (originalBaseUrl) {
      process.env.API_CENTER_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.API_CENTER_BASE_URL;
    }

    if (originalSecret) {
      process.env.API_CENTER_PLATFORM_ADMIN_SECRET = originalSecret;
    } else {
      delete process.env.API_CENTER_PLATFORM_ADMIN_SECRET;
    }
  });

  it("reads raw rows from the local evidence file provider", async () => {
    const filePath = await writeEvidenceFile();
    const provider = new LocalFilePipelineHealthProvider({ filePath });

    await expect(provider.readRows("test")).resolves.toEqual([
      expect.objectContaining({
        environment: "test",
        tribe_id: "codex-sdk-20260520041053",
      }),
    ]);
  });

  it("defaults to the local file provider", async () => {
    delete process.env.PIPELINE_HEALTH_PROVIDER;
    delete process.env.API_CENTER_PLATFORM_ADMIN_SECRET;

    await expect(resolvePipelineHealthProvider()).resolves.toBeInstanceOf(
      LocalFilePipelineHealthProvider,
    );
  });

  it("defaults to the APICenter provider when a platform admin secret is configured", async () => {
    delete process.env.PIPELINE_HEALTH_PROVIDER;
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET = "server-secret";

    await expect(resolvePipelineHealthProvider()).resolves.toBeInstanceOf(
      ApiCenterPipelineHealthProvider,
    );
  });

  it("does not resolve the default local evidence path from process.cwd", async () => {
    delete process.env.PIPELINE_HEALTH_EVIDENCE_FILE;
    const cwdSpy = vi.spyOn(process, "cwd").mockImplementation(() => {
      throw new Error("process.cwd should not be called for default evidence path");
    });

    try {
      const provider = new LocalFilePipelineHealthProvider();

      await expect(provider.readRows("test")).resolves.toEqual([]);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("reads raw rows from the APICenter provider", async () => {
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ input: String(input), init });
      return new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              environment: "test",
              tribeId: "codex-sdk-20260520041053",
              sourceServiceId: "codex-sdk-20260520041053-api",
              eventType: "codex.pipeline.flush",
              eventDay: "2026-05-20",
              eventCount: 1000,
            },
          ],
          meta: {
            environment: "test",
            source: "athena-proxy",
            timestamp: "2026-05-20T15:30:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const provider = new ApiCenterPipelineHealthProvider({
      baseUrl: "https://api-center.test",
      platformSecret: "server-secret",
      fetchImpl,
    });

    await expect(provider.readRows("test")).resolves.toEqual([
      expect.objectContaining({
        environment: "test",
        tribeId: "codex-sdk-20260520041053",
      }),
    ]);
    expect(fetchCalls[0]).toEqual(
      expect.objectContaining({
        input: "https://api-center.test/api/v1/data-pipeline/health?environment=test",
      }),
    );
    expect(fetchCalls[0].init?.headers).toEqual(
      expect.objectContaining({
        "x-platform-secret": "server-secret",
      }),
    );
  });

  it("passes partition parameters to the APICenter provider", async () => {
    const fetchCalls: string[] = [];
    const provider = new ApiCenterPipelineHealthProvider({
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

    await provider.readRows("prod", {
      year: "2026",
      month: "05",
      day: "20",
    });

    expect(fetchCalls[0]).toBe(
      "https://api-center.test/api/v1/data-pipeline/health?environment=prod&year=2026&month=05&day=20",
    );
  });
});

async function writeEvidenceFile() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pipeline-health-provider-"));
  const filePath = path.join(dir, "pipeline-health.json");
  await writeFile(
    filePath,
    JSON.stringify({
      rows: [
        {
          environment: "test",
          tribe_id: "codex-sdk-20260520041053",
          event_type: "codex.pipeline.flush",
          event_day: "2026-05-20",
          event_count: 1000,
        },
      ],
    }),
    "utf8",
  );
  return filePath;
}
