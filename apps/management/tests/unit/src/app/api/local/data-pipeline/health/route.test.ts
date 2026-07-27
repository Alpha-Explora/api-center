import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../../../../../../src/app/api/local/data-pipeline/health/route";

describe("GET /api/local/data-pipeline/health", () => {
  const originalFile = process.env.PIPELINE_HEALTH_EVIDENCE_FILE;
  const originalProvider = process.env.PIPELINE_HEALTH_PROVIDER;
  const originalBaseUrl = process.env.API_CENTER_BASE_URL;
  const originalSecret = process.env.API_CENTER_PLATFORM_ADMIN_SECRET;

  afterEach(() => {
    if (originalFile) {
      process.env.PIPELINE_HEALTH_EVIDENCE_FILE = originalFile;
    } else {
      delete process.env.PIPELINE_HEALTH_EVIDENCE_FILE;
    }

    if (originalProvider) {
      process.env.PIPELINE_HEALTH_PROVIDER = originalProvider;
    } else {
      delete process.env.PIPELINE_HEALTH_PROVIDER;
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

    vi.unstubAllGlobals();
  });

  it("returns test rows by default", async () => {
    const filePath = await writeEvidenceFile();
    process.env.PIPELINE_HEALTH_EVIDENCE_FILE = filePath;

    const response = await GET(
      new Request("http://localhost/api/local/data-pipeline/health"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.meta.environment).toBe("test");
    expect(body.meta.source).toBe("evidence-file");
    expect(body.data).toHaveLength(1);
    expect(body.data[0].tribeId).toBe("codex-sdk-20260520041053");
  });

  it("returns prod rows only when prod is requested", async () => {
    const filePath = await writeEvidenceFile();
    process.env.PIPELINE_HEALTH_EVIDENCE_FILE = filePath;

    const response = await GET(
      new Request(
        "http://localhost/api/local/data-pipeline/health?environment=prod",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.environment).toBe("prod");
    expect(body.data).toHaveLength(1);
    expect(body.data[0].tribeId).toBe("payments");
  });

  it("returns unavailable source metadata when API Center health lookup fails", async () => {
    process.env.PIPELINE_HEALTH_PROVIDER = "api-center";
    process.env.API_CENTER_BASE_URL = "https://api-center.test";
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET = "server-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("TLS handshake failed")),
    );

    const response = await GET(
      new Request("http://localhost/api/local/data-pipeline/health"),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.meta.source).toBe("athena-proxy");
    expect(body.meta.sourceMetadata[0]).toMatchObject({
      sourceType: "unavailable",
      sourceName: "pipeline-health-athena",
      durability: "none",
      degradedReason: "TLS handshake failed",
    });
  });

  it("rejects invalid environments", async () => {
    const response = await GET(
      new Request("http://localhost/api/local/data-pipeline/health?environment=raw"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("rejects incomplete partition filters", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/local/data-pipeline/health?environment=test&year=2026&month=05",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
  });
});

async function writeEvidenceFile() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pipeline-health-route-"));
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
  return filePath;
}
