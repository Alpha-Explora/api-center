# Data Pipeline Pilot And Management Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect the current data-pipeline commits, finish the test-only pilot evidence loop, and wire the management-console pipeline health panel to curated Gold/test evidence before any production pilot.

**Architecture:** Keep APICenter as the governed event export control plane and keep management as an operator surface. The next implementation should not give management or BI users raw S3 access; management reads either a server-side curated evidence file or a server-side API that returns the same `gold_platform.pipeline_health_daily` shape. Production pilot work is gated behind an explicit production topic approval.

**Tech Stack:** Git, APICenter NestJS/API docs and scripts, AWS S3/Athena via existing PowerShell scripts, Next.js management local API routes, Zod schemas, TanStack Query, Vitest.

---

## Current Baseline

Already completed:

```text
api-center
  d93d012 feat: add raw s3 pipeline validation
  cab3760 feat: add raw athena catalog foundation
  0fad4b5 feat: add bronze tribe event layer
  f164af6 feat: add apicenter ops bronze lane
  026fb06 feat: add common silver event layer
  ab2cde5 feat: add gold pipeline health metrics
  f048298 docs: add tribe silver gold templates
  c9a9bae docs: add data pipeline guardrails

apicenter-management
  031b71e feat: surface data pipeline evidence in onboarding state
  91539d0 feat: add data pipeline health panel
```

Important current state:

```text
api-center branch state: detached HEAD
api-center latest commit needing protection: c9a9bae
management latest commit: 91539d0
test physical topic: test.tribe.codex-sdk-20260520041053.events
raw bucket: api-center-raw-data
Athena output: s3://api-center-raw-data/athena-results/platform/validation/test/
AWS profile: apic
```

Do not run a production pilot until a real production physical topic is named and approved.

---

## Planned File Structure

| Path | Purpose |
| --- | --- |
| `api-center/docs/data-pipeline/actual-pipeline-runbook.md` | Record the final test-only pilot evidence and mark the prod pilot as gated. |
| `api-center/docs/superpowers/plans/2026-05-20-actual-data-pipeline-implementation.md` | Mark the completed phases and link this continuation plan if needed. |
| `apicenter-management/src/lib/pipeline-health.ts` | Shared parser/normalizer for pipeline-health rows used by API and UI tests. |
| `apicenter-management/src/lib/pipeline-health.test.ts` | Unit tests for row parsing, environment filtering, stale status data, and fixture loading. |
| `apicenter-management/src/lib/server/pipeline-health-store.ts` | Server-side evidence store reader for curated pipeline-health rows during the pilot. |
| `apicenter-management/src/lib/server/pipeline-health-store.test.ts` | Tests for reading and filtering the pilot evidence store. |
| `apicenter-management/src/app/api/local/data-pipeline/health/route.ts` | Local management API route returning curated pipeline-health rows. |
| `apicenter-management/src/app/api/local/data-pipeline/health/route.test.ts` | Route tests for test/prod filtering and malformed data handling. |
| `apicenter-management/src/lib/schemas.ts` | Zod schema and exported type for pipeline-health API response. |
| `apicenter-management/src/lib/api-center-client.ts` | Client helper `getDataPipelineHealth()`. |
| `apicenter-management/src/lib/query-keys.ts` | Query key for pipeline health. |
| `apicenter-management/src/components/data-pipeline-health-panel.tsx` | Existing presentational panel; keep it presentational. |
| `apicenter-management/src/components/service-detail-client.tsx` | Pass real rows from a query into `DataPipelineHealthPanel`. |
| `apicenter-management/.local-state/pipeline-health.json.example` | Safe example evidence file, no secrets. |

---

## Phase 0: Protect Current Commits

**Purpose:** Attach the detached `api-center` commit to a named branch before more work lands on top of it.

**Files:**
- No file edits.

- [ ] **Step 1: Confirm detached state and latest commit**

Run:

```powershell
cd C:\Codes\apic\api-center
git rev-parse --abbrev-ref HEAD
git log -1 --oneline
```

Expected:

```text
HEAD
c9a9bae docs: add data pipeline guardrails
```

- [ ] **Step 2: Create a branch at the current commit**

Run:

```powershell
cd C:\Codes\apic\api-center
git switch -c data-pipeline-implementation
```

Expected:

```text
Switched to a new branch 'data-pipeline-implementation'
```

- [ ] **Step 3: Confirm untracked files remain untouched**

Run:

```powershell
cd C:\Codes\apic\api-center
git status --short
```

Expected:

```text
?? docs/superpowers/plans/2026-05-20-control-tower-cicd-s3-telemetry.md
?? supabase/backups/
```

Do not add those files in this phase.

---

## Phase 1: Finish Test-Only Pilot Evidence

**Purpose:** Make the test topic pilot reproducible and documented end-to-end without touching production.

**Files:**
- Modify: `api-center/docs/data-pipeline/actual-pipeline-runbook.md`

- [ ] **Step 1: Re-run S3 object observation for the test topic**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\validate-s3-prefix.ps1 `
  -Bucket api-center-raw-data `
  -PhysicalTopic test.tribe.codex-sdk-20260520041053.events `
  -Profile apic
```

Expected:

```text
object_count_returned >= 1
latest_key starts with topics/test.tribe.codex-sdk-20260520041053.events/
```

- [ ] **Step 2: Re-run raw Athena validation**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\validate-raw-topic.sql `
  -Database api_center_raw `
  -Workgroup primary `
  -Environment test `
  -ResultPurpose platform-validation `
  -Profile apic `
  -Parameters @{ physical_topic = "test.tribe.codex-sdk-20260520041053.events" }
```

Expected:

```text
query status: SUCCEEDED
raw_record_count >= 1
```

- [ ] **Step 3: Re-run Bronze validation**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\validate-bronze-topic.sql `
  -Database bronze `
  -Workgroup primary `
  -Environment test `
  -ResultPurpose platform-validation `
  -Profile apic `
  -Parameters @{ physical_topic = "test.tribe.codex-sdk-20260520041053.events" }
```

Expected:

```text
query status: SUCCEEDED
environment = test
tribe_id = codex-sdk-20260520041053
source_service_id = codex-sdk-20260520041053-api
quality_status = valid
event_count >= 1
```

- [ ] **Step 4: Re-run Common Silver validation**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\validate-common-silver.sql `
  -Database common_silver `
  -Workgroup primary `
  -Environment test `
  -ResultPurpose platform-validation `
  -Profile apic `
  -Parameters @{ physical_topic = "test.tribe.codex-sdk-20260520041053.events" }
```

Expected:

```text
query status: SUCCEEDED
environment = test
event_count >= 1
```

- [ ] **Step 5: Re-run Gold pipeline-health query for test**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\pipeline-health-daily.sql `
  -Database gold_platform `
  -Workgroup primary `
  -Environment test `
  -ResultPurpose platform-validation `
  -Profile apic `
  -Parameters @{ environment = "test" }
```

Expected:

```text
query status: SUCCEEDED
row exists for tribe_id = codex-sdk-20260520041053
row has event_count >= 1
```

- [ ] **Step 6: Verify test rows do not appear in prod mode**

Run this Athena query through the console or a temporary local query file:

```sql
SELECT COUNT(*) AS test_records_in_prod
FROM gold_platform.pipeline_health_daily
WHERE environment = 'prod'
  AND tribe_id = 'codex-sdk-20260520041053';
```

Expected:

```text
test_records_in_prod = 0
```

- [ ] **Step 7: Record the final test-only pilot evidence**

Add this section to `api-center/docs/data-pipeline/actual-pipeline-runbook.md` with the real query IDs and counts from Steps 1-6:

````markdown
## Test-Only Pilot Completion, 2026-05-20

```text
physical_topic: test.tribe.codex-sdk-20260520041053.events
environment: test
s3_object_count:
latest_s3_object_key:
raw_query_id:
raw_record_count:
bronze_query_id:
bronze_valid_count:
common_silver_query_id:
common_silver_count:
gold_query_id:
gold_event_count:
prod_leak_guard_query_id:
prod_leak_guard_count: 0
operator:
checked_at:
```

The pilot remains test-only. Production pilot execution requires an approved
production physical topic and a named operator.
````

- [ ] **Step 8: Commit Phase 1**

Run:

```powershell
cd C:\Codes\apic\api-center
git add docs/data-pipeline/actual-pipeline-runbook.md
git commit -m "docs: record test data pipeline pilot evidence"
```

---

## Phase 2: Add Management Pipeline Health Data Contract

**Purpose:** Define the API shape that the management panel will consume.

**Files:**
- Modify: `apicenter-management/src/lib/schemas.ts`
- Create: `apicenter-management/src/lib/pipeline-health.ts`
- Create: `apicenter-management/src/lib/pipeline-health.test.ts`

- [ ] **Step 1: Add failing schema and normalizer tests**

Create `apicenter-management/src/lib/pipeline-health.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  filterPipelineHealthRows,
  normalizePipelineHealthRows,
} from "./pipeline-health";

describe("pipeline health rows", () => {
  it("normalizes Athena-style snake case rows into panel rows", () => {
    const rows = normalizePipelineHealthRows([
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
    ]);

    expect(rows).toEqual([
      {
        environment: "test",
        tribeId: "codex-sdk-20260520041053",
        sourceServiceId: "codex-sdk-20260520041053-api",
        eventType: "codex.pipeline.flush",
        eventDay: "2026-05-20",
        eventCount: 1000,
        latestOccurredAt: "2026-05-20T09:41:45.721Z",
        latestIngestedAt: "2026-05-20T09:42:00.000Z",
      },
    ]);
  });

  it("keeps prod and test rows isolated by environment", () => {
    const rows = normalizePipelineHealthRows([
      {
        environment: "test",
        tribe_id: "codex",
        event_type: "codex.pipeline.flush",
        event_day: "2026-05-20",
        event_count: 1,
      },
      {
        environment: "prod",
        tribe_id: "payments",
        event_type: "payment.completed",
        event_day: "2026-05-20",
        event_count: 2,
      },
    ]);

    expect(filterPipelineHealthRows(rows, "test")).toHaveLength(1);
    expect(filterPipelineHealthRows(rows, "test")[0]?.tribeId).toBe("codex");
    expect(filterPipelineHealthRows(rows, "prod")).toHaveLength(1);
    expect(filterPipelineHealthRows(rows, "prod")[0]?.tribeId).toBe("payments");
  });
});
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- pipeline-health.test.ts
```

Expected:

```text
FAIL because src/lib/pipeline-health.ts does not exist
```

- [ ] **Step 2: Add schemas in `src/lib/schemas.ts`**

Add near the analytics schemas:

```ts
export const pipelineHealthEnvironmentSchema = z.enum(["test", "prod"]);

export const pipelineHealthRowSchema = z.object({
  environment: pipelineHealthEnvironmentSchema,
  tribeId: z.string(),
  sourceServiceId: z.string().optional(),
  eventType: z.string(),
  eventDay: z.string(),
  eventCount: z.number(),
  latestOccurredAt: z.string().optional(),
  latestIngestedAt: z.string().optional(),
});

export const pipelineHealthResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(pipelineHealthRowSchema),
  meta: z.object({
    environment: pipelineHealthEnvironmentSchema,
    source: z.enum(["evidence-file", "athena-proxy"]),
    timestamp: z.string(),
  }),
});
```

Add exported types:

```ts
export type PipelineHealthEnvironment = z.infer<
  typeof pipelineHealthEnvironmentSchema
>;
export type PipelineHealthRow = z.infer<typeof pipelineHealthRowSchema>;
export type PipelineHealthResponse = z.infer<
  typeof pipelineHealthResponseSchema
>;
```

- [ ] **Step 3: Implement the normalizer**

Create `apicenter-management/src/lib/pipeline-health.ts`:

```ts
import {
  pipelineHealthEnvironmentSchema,
  type PipelineHealthEnvironment,
  type PipelineHealthRow,
} from "@/lib/schemas";

type RawPipelineHealthRow = {
  environment?: unknown;
  tribe_id?: unknown;
  tribeId?: unknown;
  source_service_id?: unknown;
  sourceServiceId?: unknown;
  event_type?: unknown;
  eventType?: unknown;
  event_day?: unknown;
  eventDay?: unknown;
  event_count?: unknown;
  eventCount?: unknown;
  latest_occurred_at?: unknown;
  latestOccurredAt?: unknown;
  latest_ingested_at?: unknown;
  latestIngestedAt?: unknown;
};

export function normalizePipelineHealthRows(
  rows: RawPipelineHealthRow[],
): PipelineHealthRow[] {
  return rows.map((row) => ({
    environment: pipelineHealthEnvironmentSchema.parse(row.environment),
    tribeId: readRequiredString(row.tribeId ?? row.tribe_id, "tribe_id"),
    sourceServiceId: readOptionalString(
      row.sourceServiceId ?? row.source_service_id,
    ),
    eventType: readRequiredString(row.eventType ?? row.event_type, "event_type"),
    eventDay: readRequiredString(row.eventDay ?? row.event_day, "event_day"),
    eventCount: readNumber(row.eventCount ?? row.event_count, "event_count"),
    latestOccurredAt: readOptionalString(
      row.latestOccurredAt ?? row.latest_occurred_at,
    ),
    latestIngestedAt: readOptionalString(
      row.latestIngestedAt ?? row.latest_ingested_at,
    ),
  }));
}

export function filterPipelineHealthRows(
  rows: PipelineHealthRow[],
  environment: PipelineHealthEnvironment,
) {
  return rows.filter((row) => row.environment === environment);
}

function readRequiredString(value: unknown, fieldName: string) {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`${fieldName} is required`);
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown, fieldName: string) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`${fieldName} must be a number`);
}
```

- [ ] **Step 4: Run the normalizer tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- pipeline-health.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 5: Commit Phase 2**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
git add src/lib/schemas.ts src/lib/pipeline-health.ts src/lib/pipeline-health.test.ts
git commit -m "feat: add pipeline health data contract"
```

---

## Phase 3: Add Server-Side Evidence Store For Pilot Rows

**Purpose:** Give the management route a safe pilot data source before adding a live Athena proxy.

**Files:**
- Create: `apicenter-management/src/lib/server/pipeline-health-store.ts`
- Create: `apicenter-management/src/lib/server/pipeline-health-store.test.ts`
- Create: `apicenter-management/.local-state/pipeline-health.json.example`

- [ ] **Step 1: Add failing store tests**

Create `apicenter-management/src/lib/server/pipeline-health-store.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { readPipelineHealthRows } from "./pipeline-health-store";

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
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- pipeline-health-store.test.ts
```

Expected:

```text
FAIL because src/lib/server/pipeline-health-store.ts does not exist
```

- [ ] **Step 2: Implement the evidence store**

Create `apicenter-management/src/lib/server/pipeline-health-store.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  filterPipelineHealthRows,
  normalizePipelineHealthRows,
} from "@/lib/pipeline-health";
import {
  pipelineHealthEnvironmentSchema,
  type PipelineHealthEnvironment,
} from "@/lib/schemas";

const storeSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
});

export async function readPipelineHealthRows(options?: {
  filePath?: string;
  environment?: PipelineHealthEnvironment;
}) {
  const environment = pipelineHealthEnvironmentSchema.parse(
    options?.environment ?? "test",
  );
  const filePath = resolvePipelineHealthFile(options?.filePath);

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = storeSchema.parse(JSON.parse(raw));
    return filterPipelineHealthRows(
      normalizePipelineHealthRows(parsed.rows),
      environment,
    );
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

function resolvePipelineHealthFile(filePath: string | undefined) {
  return (
    filePath ??
    process.env.PIPELINE_HEALTH_EVIDENCE_FILE ??
    path.join(
      /* turbopackIgnore: true */ process.cwd(),
      ".local-state",
      "pipeline-health.json",
    )
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
```

- [ ] **Step 3: Add a safe example evidence file**

Create `apicenter-management/.local-state/pipeline-health.json.example`:

```json
{
  "rows": [
    {
      "environment": "test",
      "tribe_id": "codex-sdk-20260520041053",
      "source_service_id": "codex-sdk-20260520041053-api",
      "event_type": "codex.pipeline.flush",
      "event_day": "2026-05-20",
      "event_count": 1000,
      "latest_occurred_at": "2026-05-20T09:41:45.721Z",
      "latest_ingested_at": "2026-05-20T09:42:00.000Z"
    }
  ]
}
```

- [ ] **Step 4: Run store tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- pipeline-health-store.test.ts pipeline-health.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 5: Commit Phase 3**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
git add src/lib/server/pipeline-health-store.ts src/lib/server/pipeline-health-store.test.ts .local-state/pipeline-health.json.example
git commit -m "feat: add pipeline health evidence store"
```

---

## Phase 4: Add Management API Route And Client

**Purpose:** Expose curated pipeline-health rows to the management UI through a local server route.

**Files:**
- Create: `apicenter-management/src/app/api/local/data-pipeline/health/route.ts`
- Create: `apicenter-management/src/app/api/local/data-pipeline/health/route.test.ts`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Modify: `apicenter-management/src/lib/query-keys.ts`

- [ ] **Step 1: Add failing route tests**

Create `apicenter-management/src/app/api/local/data-pipeline/health/route.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/local/data-pipeline/health", () => {
  const originalFile = process.env.PIPELINE_HEALTH_EVIDENCE_FILE;

  afterEach(() => {
    process.env.PIPELINE_HEALTH_EVIDENCE_FILE = originalFile;
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
    expect(body.data).toHaveLength(1);
    expect(body.data[0].tribeId).toBe("codex-sdk-20260520041053");
  });

  it("returns prod rows only when prod is requested", async () => {
    const filePath = await writeEvidenceFile();
    process.env.PIPELINE_HEALTH_EVIDENCE_FILE = filePath;

    const response = await GET(
      new Request("http://localhost/api/local/data-pipeline/health?environment=prod"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.environment).toBe("prod");
    expect(body.data).toHaveLength(1);
    expect(body.data[0].tribeId).toBe("payments");
  });

  it("rejects invalid environments", async () => {
    const response = await GET(
      new Request("http://localhost/api/local/data-pipeline/health?environment=raw"),
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
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- route.test.ts
```

Expected:

```text
FAIL because route.ts does not exist
```

- [ ] **Step 2: Implement the route**

Create `apicenter-management/src/app/api/local/data-pipeline/health/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { readPipelineHealthRows } from "@/lib/server/pipeline-health-store";
import {
  pipelineHealthEnvironmentSchema,
  pipelineHealthResponseSchema,
} from "@/lib/schemas";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const environment = pipelineHealthEnvironmentSchema.parse(
      searchParams.get("environment") ?? "test",
    );
    const rows = await readPipelineHealthRows({ environment });
    const body = pipelineHealthResponseSchema.parse({
      success: true,
      data: rows,
      meta: {
        environment,
        source: "evidence-file",
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Pipeline health lookup failed.",
      },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Add client helper and query key**

In `apicenter-management/src/lib/api-center-client.ts`, import:

```ts
  pipelineHealthResponseSchema,
  type PipelineHealthEnvironment,
  type PipelineHealthRow,
```

Add:

```ts
export async function getDataPipelineHealth(
  environment: PipelineHealthEnvironment = "test",
): Promise<PipelineHealthRow[]> {
  const data = await request<unknown>(
    `/api/local/data-pipeline/health?environment=${encodeURIComponent(environment)}`,
  );

  return pipelineHealthResponseSchema.parse(data).data;
}
```

In `apicenter-management/src/lib/query-keys.ts`, add:

```ts
  dataPipelineHealth: (environment: string) =>
    ["data-pipeline", "health", environment] as const,
```

- [ ] **Step 4: Run route and client-adjacent tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- route.test.ts pipeline-health-store.test.ts pipeline-health.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 5: Commit Phase 4**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
git add src/app/api/local/data-pipeline/health/route.ts src/app/api/local/data-pipeline/health/route.test.ts src/lib/api-center-client.ts src/lib/query-keys.ts
git commit -m "feat: expose pipeline health rows to management"
```

---

## Phase 5: Wire Management Panel To The API

**Purpose:** Replace the static empty panel wiring with real query-backed rows in the tribe observability tab.

**Files:**
- Modify: `apicenter-management/src/components/service-detail-client.tsx`
- Modify: `apicenter-management/src/components/service-detail-client.test.tsx`
- Modify: `apicenter-management/src/components/data-pipeline-health-panel.test.tsx`

- [ ] **Step 1: Add failing service detail test**

Update `apicenter-management/src/components/service-detail-client.test.tsx` so the mocked API client includes:

```ts
getDataPipelineHealth: vi.fn(),
```

Add a test that opens the observability tab and verifies the pipeline health query result is shown:

```ts
it("loads data pipeline health rows for tribe observability", async () => {
  apiClient.getDataPipelineHealth.mockResolvedValue([
    {
      environment: "test",
      tribeId: "codex-sdk-20260520041053",
      sourceServiceId: "codex-sdk-20260520041053-api",
      eventType: "codex.pipeline.flush",
      eventDay: "2026-05-20",
      eventCount: 1000,
      latestOccurredAt: "2026-05-20T09:41:45.721Z",
      latestIngestedAt: "2026-05-20T09:42:00.000Z",
    },
  ]);

  renderWithClient(
    <ServiceDetailClient serviceId="codex-sdk-20260520041053" initialSection="observability" />,
  );

  expect(await screen.findByText("Data pipeline health")).toBeTruthy();
  expect(await screen.findByText("codex.pipeline.flush")).toBeTruthy();
  expect(apiClient.getDataPipelineHealth).toHaveBeenCalledWith("test");
});
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- service-detail-client.test.tsx
```

Expected:

```text
FAIL because ServiceDetailClient still renders DataPipelineHealthPanel without query rows
```

- [ ] **Step 2: Wire the query in `ServiceDetailClient`**

In `apicenter-management/src/components/service-detail-client.tsx`, import:

```ts
  getDataPipelineHealth,
```

Create the query near the other queries:

```ts
  const pipelineHealthEnvironment = "test";
  const pipelineHealthQuery = useQuery({
    queryKey: queryKeys.dataPipelineHealth(pipelineHealthEnvironment),
    queryFn: () => getDataPipelineHealth(pipelineHealthEnvironment),
    enabled: activeSection === "observability" && isTribe,
    retry: 1,
  });
```

Pass it into the panel:

```tsx
<DataPipelineHealthPanel
  rows={pipelineHealthQuery.data ?? []}
  loading={pipelineHealthQuery.isLoading || pipelineHealthQuery.isFetching}
/>
```

Keep the environment as `"test"` until a production pilot is explicitly approved.

- [ ] **Step 3: Run component tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- service-detail-client.test.tsx data-pipeline-health-panel.test.tsx
```

Expected:

```text
PASS
```

- [ ] **Step 4: Run focused regression tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- data-pipeline-health-panel.test.tsx service-detail-client.test.tsx service-onboarding.test.ts tribe-onboarding-flow.test.tsx pipeline-health.test.ts pipeline-health-store.test.ts route.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 5: Commit Phase 5**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
git add src/components/service-detail-client.tsx src/components/service-detail-client.test.tsx src/components/data-pipeline-health-panel.test.tsx
git commit -m "feat: wire pipeline health panel to management data"
```

---

## Phase 6: Production Pilot Gate

**Purpose:** Define the production pilot requirements without running them prematurely.

**Files:**
- Modify: `api-center/docs/data-pipeline/actual-pipeline-runbook.md`
- Modify: `api-center/docs/data-pipeline/metric-dictionary.md`

- [ ] **Step 1: Add production pilot gate fields**

In `api-center/docs/data-pipeline/actual-pipeline-runbook.md`, add:

````markdown
## Production Pilot Gate

Do not run production validation until these fields are complete:

```text
approved_prod_physical_topic:
owner_tribe_id:
source_service_ids:
data_owner:
data_steward:
approved_reader_groups:
metric_dictionary_rows_approved:
raw_prod_retention_days:
athena_workgroup:
bytes_scanned_limit:
operator:
approval_timestamp:
```

After approval, repeat the same S3, Raw, Bronze, Common Silver, Gold, and prod
leak-guard checks from the test pilot with `environment = 'prod'`.
````

- [ ] **Step 2: Add metric approval reminder**

In `api-center/docs/data-pipeline/metric-dictionary.md`, add:

```markdown
## Production Pilot Approval

No production dashboard row is approved until:

| Requirement | Required value |
| --- | --- |
| Metric owner | Named platform or tribe owner |
| Formula | Recorded in this dictionary |
| Source | Gold or approved Tribe Silver only |
| Environment filter | `environment = 'prod'` |
| Raw S3 access | Not granted to BI users |
| Reader group | Named approved group |
| Review date | Recorded before dashboard refresh |
```

- [ ] **Step 3: Commit Phase 6**

Run:

```powershell
cd C:\Codes\apic\api-center
git add docs/data-pipeline/actual-pipeline-runbook.md docs/data-pipeline/metric-dictionary.md
git commit -m "docs: add production pilot gate"
```

---

## Phase 7: Final Verification And Handoff

**Purpose:** Confirm the plan is complete through test-only management visibility and clearly separate remaining prod approval work.

**Files:**
- Modify: `api-center/docs/superpowers/plans/2026-05-20-actual-data-pipeline-implementation.md`

- [ ] **Step 1: Run final management verification**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- data-pipeline-health-panel.test.tsx service-detail-client.test.tsx service-onboarding.test.ts tribe-onboarding-flow.test.tsx pipeline-health.test.ts pipeline-health-store.test.ts route.test.ts
npm run lint
```

Expected:

```text
tests pass
lint has 0 errors
existing owner-tribe-migration warnings may remain if still present
```

- [ ] **Step 2: Run final API Center status check**

Run:

```powershell
cd C:\Codes\apic\api-center
git status --short
git log -5 --oneline
```

Expected:

```text
only known unrelated untracked files remain
latest commits include production pilot gate and test pilot evidence
```

- [ ] **Step 3: Update the original implementation plan status**

In `api-center/docs/superpowers/plans/2026-05-20-actual-data-pipeline-implementation.md`, add a short completion note under Phase 10:

```markdown
### Continuation Status, 2026-05-20

The test-only pilot and management health wiring continue in
`2026-05-20-data-pipeline-pilot-and-management-health.md`.
Production pilot execution remains gated behind an approved production physical
topic and metric-reader approval.
```

- [ ] **Step 4: Commit Phase 7**

Run:

```powershell
cd C:\Codes\apic\api-center
git add docs/superpowers/plans/2026-05-20-actual-data-pipeline-implementation.md
git commit -m "docs: link data pipeline pilot continuation"
```

---

## Completion Criteria

- `api-center` is no longer on detached `HEAD`; the data pipeline commits are on a named branch.
- Test topic `test.tribe.codex-sdk-20260520041053.events` has documented S3, Raw, Bronze, Common Silver, and Gold evidence.
- Gold prod leak guard for the test tribe returns `0`.
- Management exposes a server-side `/api/local/data-pipeline/health?environment=test` route.
- Management panel renders real test pipeline-health rows through TanStack Query.
- No Raw S3 credentials or Athena credentials are exposed to browser code.
- Production pilot is documented as gated and has not been run without an approved production physical topic.
- Focused management tests pass.
- Lint has no new errors.

## Known Risks

- The first management data source is an evidence file, not a live Athena proxy. This is intentional for the pilot because it avoids putting AWS/Athena credentials into the management UI too early.
- A live Athena-backed route will need server-only AWS credentials, scan limits, timeout handling, and query-result caching before scheduled dashboard use.
- Current `api-center` branch state must be fixed before any more commits; otherwise future commits can be lost when switching branches.
- Production pilot work requires explicit approval because it touches real production topics and access-control expectations.
