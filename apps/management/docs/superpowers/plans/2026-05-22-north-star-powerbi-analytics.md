# North-Star Power BI Analytics Implementation Plan

Follow-up: the management implementation has since moved from Power BI-only
embedding to provider-neutral `BI_NORTH_STAR_*` configuration for Power BI,
Looker, and Looker Studio. Existing `POWERBI_NORTH_STAR_*` variables remain as
a compatibility fallback, but new deployments should use `BI_NORTH_STAR_*`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the management `/data-pipeline` page into a north-star analytics surface that answers the APICenter traceability question through native curated metrics and an optional embedded Power BI report.

**Architecture:** Keep APICenter and Athena Gold/materialized outputs as the data authority. `apicenter-management` remains an operator UI that reads the existing `/api/local/data-pipeline/*` routes, summarizes their rows into north-star status, and embeds Power BI only as a governed presentation layer when explicitly configured. The browser must never receive raw AWS credentials, raw S3 paths as BI sources, or Power BI service secrets.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, TanStack Query, shadcn/base-ui tabs, lucide-react, Vitest, Testing Library, existing APICenter data-pipeline APIs, Power BI secure iframe embed URL.

---

## Current Baseline

The repo already has the foundation this feature should reuse:

| Existing surface | Role in this plan |
| --- | --- |
| `apicenter-management/src/app/data-pipeline/page.tsx` | Server route for the operator data-pipeline page. |
| `apicenter-management/src/components/data-pipeline-dashboard-client.tsx` | Client component that fetches health, quality, shared-service usage, gateway decisions, cost, and decision signals. |
| `apicenter-management/src/components/data-pipeline-health-panel.tsx` | Native Gold pipeline-health evidence panel. |
| `apicenter-management/src/components/data-pipeline-governance-panel.tsx` | Native quality, gateway, shared-service, and decision-signal panel. |
| `apicenter-management/src/components/data-pipeline-cost-panel.tsx` | Native Athena scan/cost panel. |
| `apicenter-management/src/lib/schemas.ts` | Existing typed row contracts for all data-pipeline rows. |
| `api-center/docs/data-pipeline/platform-team-north-star-bi-plan.md` | Current north-star BI plan. |
| `api-center/docs/data-pipeline/bi-handoff-runbook.md` | Current BI handoff and governed-source rules. |

The north-star question to show in the UI is:

```text
From tribe request to gateway decision to event export to visualization,
can we trace who called what, whether it was allowed, what happened,
how much it cost, and where the data landed?
```

---

## Planned File Structure

| Path | Purpose |
| --- | --- |
| `apicenter-management/.env.example` | Document optional Power BI embed configuration. |
| `apicenter-management/src/lib/server/north-star-powerbi-config.ts` | Server-only environment reader and sanitizer for Power BI embed config. |
| `apicenter-management/src/lib/server/north-star-powerbi-config.test.ts` | Unit tests for disabled, invalid, and configured embed states. |
| `apicenter-management/src/lib/data-pipeline/north-star-summary.ts` | Pure summary model that converts existing data-pipeline rows into north-star answers. |
| `apicenter-management/src/lib/data-pipeline/north-star-summary.test.ts` | Unit tests for complete, warning, and not-ready north-star states. |
| `apicenter-management/src/components/north-star-summary-panel.tsx` | Presentational panel for the top answer and supporting question cards. |
| `apicenter-management/src/components/north-star-summary-panel.test.tsx` | Rendering tests for the native summary panel. |
| `apicenter-management/src/components/powerbi-embed-panel.tsx` | Presentational guarded iframe panel for the optional Power BI report. |
| `apicenter-management/src/components/powerbi-embed-panel.test.tsx` | Rendering tests for configured and unconfigured Power BI states. |
| `apicenter-management/src/components/data-pipeline-dashboard-client.tsx` | Wire the summary model, tabs, and Power BI embed into the existing page. |
| `apicenter-management/src/app/data-pipeline/page.tsx` | Read server-side embed config and pass it into the client dashboard. |
| `api-center/docs/data-pipeline/platform-team-north-star-bi-plan.md` | Add the management embed rollout section and report-page expectations. |
| `api-center/docs/data-pipeline/bi-handoff-runbook.md` | Add governed Power BI embed rules and environment separation checks. |

---

## Phase 0: Baseline Check And Scope Guard

**Purpose:** Confirm the current data-pipeline UI and tests before adding new components.

**Files:**
- No file edits.

- [ ] **Step 1: Check current worktree**

Run:

```powershell
cd C:\Codes\apic
git status --short
```

Expected: note any existing user changes. Do not revert unrelated changes.

- [ ] **Step 2: Run current focused management tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/data-pipeline-health-panel.test.tsx src/components/data-pipeline-governance-panel.test.tsx src/components/data-pipeline-cost-panel.test.tsx
```

Expected: all existing data-pipeline component tests pass before new work starts.

- [ ] **Step 3: Confirm the page still builds in TypeScript**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run typecheck
```

Expected: `tsc --noEmit` completes without errors.

---

## Phase 1: Power BI Embed Configuration

**Purpose:** Add a server-only configuration boundary so the UI can embed a Power BI report without exposing secrets or making the client read `process.env` directly.

**Files:**
- Modify: `apicenter-management/.env.example`
- Create: `apicenter-management/src/lib/server/north-star-powerbi-config.ts`
- Create: `apicenter-management/src/lib/server/north-star-powerbi-config.test.ts`

- [ ] **Step 1: Write failing config tests**

Create `src/lib/server/north-star-powerbi-config.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getNorthStarPowerBiConfig } from "./north-star-powerbi-config";

const ORIGINAL_ENV = process.env;

describe("getNorthStarPowerBiConfig", () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.unstubAllEnvs();
  });

  it("is disabled when POWERBI_NORTH_STAR_ENABLED is not true", () => {
    vi.stubEnv("POWERBI_NORTH_STAR_ENABLED", "false");
    vi.stubEnv("POWERBI_NORTH_STAR_EMBED_URL", "https://app.powerbi.com/reportEmbed?reportId=abc");

    expect(getNorthStarPowerBiConfig()).toEqual({
      enabled: false,
      embedUrl: undefined,
      reportId: undefined,
    });
  });

  it("is disabled when the embed URL is missing", () => {
    vi.stubEnv("POWERBI_NORTH_STAR_ENABLED", "true");
    vi.stubEnv("POWERBI_NORTH_STAR_REPORT_ID", "north-star-report");

    expect(getNorthStarPowerBiConfig()).toEqual({
      enabled: false,
      embedUrl: undefined,
      reportId: "north-star-report",
    });
  });

  it("rejects non-HTTPS embed URLs", () => {
    vi.stubEnv("POWERBI_NORTH_STAR_ENABLED", "true");
    vi.stubEnv("POWERBI_NORTH_STAR_EMBED_URL", "http://example.test/report");
    vi.stubEnv("POWERBI_NORTH_STAR_REPORT_ID", "north-star-report");

    expect(getNorthStarPowerBiConfig()).toEqual({
      enabled: false,
      embedUrl: undefined,
      reportId: "north-star-report",
    });
  });

  it("returns sanitized config for an HTTPS Power BI embed URL", () => {
    vi.stubEnv("POWERBI_NORTH_STAR_ENABLED", "true");
    vi.stubEnv(
      "POWERBI_NORTH_STAR_EMBED_URL",
      "https://app.powerbi.com/reportEmbed?reportId=abc&groupId=workspace",
    );
    vi.stubEnv("POWERBI_NORTH_STAR_REPORT_ID", "north-star-report");

    expect(getNorthStarPowerBiConfig()).toEqual({
      enabled: true,
      embedUrl: "https://app.powerbi.com/reportEmbed?reportId=abc&groupId=workspace",
      reportId: "north-star-report",
    });
  });
});
```

- [ ] **Step 2: Run the failing config test**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/server/north-star-powerbi-config.test.ts
```

Expected: fail because `north-star-powerbi-config.ts` does not exist.

- [ ] **Step 3: Implement server-only config reader**

Create `src/lib/server/north-star-powerbi-config.ts`:

```ts
import "server-only";

export type NorthStarPowerBiConfig = {
  enabled: boolean;
  embedUrl?: string;
  reportId?: string;
};

export function getNorthStarPowerBiConfig(
  env: NodeJS.ProcessEnv = process.env,
): NorthStarPowerBiConfig {
  const reportId = cleanOptional(env.POWERBI_NORTH_STAR_REPORT_ID);
  const enabledFlag = env.POWERBI_NORTH_STAR_ENABLED === "true";
  const embedUrl = cleanOptional(env.POWERBI_NORTH_STAR_EMBED_URL);

  if (!enabledFlag || !embedUrl || !isAllowedPowerBiEmbedUrl(embedUrl)) {
    return {
      enabled: false,
      embedUrl: undefined,
      reportId,
    };
  }

  return {
    enabled: true,
    embedUrl,
    reportId,
  };
}

function cleanOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isAllowedPowerBiEmbedUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.endsWith("powerbi.com");
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Document optional env vars**

Add this section to `apicenter-management/.env.example` after the data-pipeline or management environment block:

```dotenv
# ---------------------------------------------------------------------------
# Optional Power BI north-star embed
# ---------------------------------------------------------------------------
#
# The management console embeds Power BI only as a governed presentation layer.
# Power BI must read Gold or materialized outputs, not Raw S3.
POWERBI_NORTH_STAR_ENABLED=false
POWERBI_NORTH_STAR_REPORT_ID=
POWERBI_NORTH_STAR_EMBED_URL=
```

- [ ] **Step 5: Verify config tests pass**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/server/north-star-powerbi-config.test.ts
```

Expected: all config tests pass.

- [ ] **Step 6: Commit Phase 1**

Run:

```powershell
cd C:\Codes\apic
git add apicenter-management/.env.example apicenter-management/src/lib/server/north-star-powerbi-config.ts apicenter-management/src/lib/server/north-star-powerbi-config.test.ts
git commit -m "feat: add north-star powerbi config"
```

---

## Phase 2: Native North-Star Summary Model

**Purpose:** Build a pure TypeScript model that summarizes existing APICenter Gold/API rows into the north-star answer and supporting questions. This keeps business logic out of React components.

**Files:**
- Create: `apicenter-management/src/lib/data-pipeline/north-star-summary.ts`
- Create: `apicenter-management/src/lib/data-pipeline/north-star-summary.test.ts`

- [ ] **Step 1: Write failing summary tests**

Create `src/lib/data-pipeline/north-star-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildNorthStarSummary } from "./north-star-summary";

describe("buildNorthStarSummary", () => {
  it("marks the north-star answer complete when all evidence categories are present", () => {
    const summary = buildNorthStarSummary({
      healthRows: [
        {
          environment: "prod",
          tribeId: "logistics",
          sourceServiceId: "logistics-orders",
          eventType: "order.created",
          eventDay: "2026-05-20",
          eventCount: 12,
          latestIngestedAt: "2026-05-20T10:00:00.000Z",
          latestGoldObservedAt: "2026-05-20T10:05:00.000Z",
        },
      ],
      qualityRows: [
        {
          environment: "prod",
          tribeId: "logistics",
          sourceServiceId: "logistics-orders",
          eventType: "order.created",
          eventDay: "2026-05-20",
          eventCount: 12,
          validEventCount: 12,
          invalidEventCount: 0,
          qualityErrorCount: 0,
        },
      ],
      sharedServiceUsageRows: [
        {
          environment: "prod",
          tribeId: "logistics",
          sharedServiceId: "payment",
          provider: "paymongo",
          providerStatus: "ok",
          eventDay: "2026-05-20",
          eventCount: 5,
          successCount: 5,
          failureCount: 0,
        },
      ],
      gatewayDecisionRows: [
        {
          environment: "prod",
          tribeId: "logistics",
          sourceServiceId: "logistics-orders",
          targetServiceId: "payment",
          scope: "shared:payment:write",
          decision: "allowed",
          eventDay: "2026-05-20",
          decisionCount: 5,
          allowedCount: 5,
          deniedCount: 0,
        },
      ],
      costRows: [
        {
          environment: "prod",
          workgroup: "api-center-platform-validation-prod",
          resultPurpose: "platform-validation",
          eventDay: "2026-05-20",
          queryCount: 2,
          bytesScanned: 1048576,
          estimatedCostUsd: 0.01,
        },
      ],
      decisionSignalRows: [],
      powerBiEnabled: true,
    });

    expect(summary.status).toBe("complete");
    expect(summary.answer).toContain("Traceable");
    expect(summary.metrics.totalEvents).toBe(12);
    expect(summary.metrics.allowedGatewayDecisions).toBe(5);
    expect(summary.metrics.powerBiConfigured).toBe(true);
    expect(summary.questions.every((question) => question.status === "complete")).toBe(true);
  });

  it("marks warning when governed rows exist but review signals are open", () => {
    const summary = buildNorthStarSummary({
      healthRows: [
        {
          environment: "test",
          tribeId: "codex",
          eventType: "codex.pipeline.flush",
          eventDay: "2026-05-20",
          eventCount: 1,
        },
      ],
      qualityRows: [],
      sharedServiceUsageRows: [],
      gatewayDecisionRows: [],
      costRows: [],
      decisionSignalRows: [
        {
          signalId: "test:pipeline_stale:codex",
          environment: "test",
          tribeId: "codex",
          signalType: "pipeline_stale",
          severity: "high",
          metricName: "latest_ingested_at_age_hours",
          observedValue: 25,
          expectedValue: 24,
          recommendation: "check connector lag",
          evidenceWindowStart: "2026-05-20T00:00:00.000Z",
          evidenceWindowEnd: "2026-05-20T23:59:59.000Z",
          createdAt: "2026-05-20T23:00:00.000Z",
          status: "open",
        },
      ],
      powerBiEnabled: false,
    });

    expect(summary.status).toBe("warning");
    expect(summary.metrics.openDecisionSignals).toBe(1);
    expect(summary.questions.find((question) => question.key === "visualization")?.status).toBe("missing");
  });

  it("marks not-ready when no curated rows are present", () => {
    const summary = buildNorthStarSummary({
      healthRows: [],
      qualityRows: [],
      sharedServiceUsageRows: [],
      gatewayDecisionRows: [],
      costRows: [],
      decisionSignalRows: [],
      powerBiEnabled: false,
    });

    expect(summary.status).toBe("missing");
    expect(summary.answer).toContain("Not enough curated evidence");
  });
});
```

- [ ] **Step 2: Run failing summary tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/data-pipeline/north-star-summary.test.ts
```

Expected: fail because `north-star-summary.ts` does not exist.

- [ ] **Step 3: Implement summary model**

Create `src/lib/data-pipeline/north-star-summary.ts`:

```ts
import type {
  PipelineAthenaCostRow,
  PipelineDecisionSignalRow,
  PipelineGatewayDecisionRow,
  PipelineHealthRow,
  PipelineQualityRow,
  PipelineSharedServiceUsageRow,
} from "@/lib/schemas";

export type NorthStarQuestionKey =
  | "ownership"
  | "gateway"
  | "export"
  | "quality"
  | "cost"
  | "visualization";

export type NorthStarStatus = "complete" | "warning" | "missing";

export type NorthStarQuestion = {
  key: NorthStarQuestionKey;
  label: string;
  answer: string;
  status: NorthStarStatus;
  evidenceCount: number;
};

export type NorthStarSummary = {
  status: NorthStarStatus;
  answer: string;
  metrics: {
    totalEvents: number;
    uniqueTribes: number;
    uniqueSourceServices: number;
    allowedGatewayDecisions: number;
    deniedGatewayDecisions: number;
    qualityErrors: number;
    sharedServiceFailures: number;
    estimatedCostUsd: number;
    openDecisionSignals: number;
    powerBiConfigured: boolean;
  };
  questions: NorthStarQuestion[];
};

export function buildNorthStarSummary(input: {
  healthRows: PipelineHealthRow[];
  qualityRows: PipelineQualityRow[];
  sharedServiceUsageRows: PipelineSharedServiceUsageRow[];
  gatewayDecisionRows: PipelineGatewayDecisionRow[];
  costRows: PipelineAthenaCostRow[];
  decisionSignalRows: PipelineDecisionSignalRow[];
  powerBiEnabled: boolean;
}): NorthStarSummary {
  const totalEvents = sum(input.healthRows, (row) => row.eventCount);
  const uniqueTribes = new Set([
    ...input.healthRows.map((row) => row.tribeId),
    ...input.gatewayDecisionRows.map((row) => row.tribeId),
    ...input.qualityRows.map((row) => row.tribeId),
  ]).size;
  const uniqueSourceServices = new Set(
    input.healthRows
      .map((row) => row.sourceServiceId)
      .filter((value): value is string => Boolean(value)),
  ).size;
  const allowedGatewayDecisions = sum(
    input.gatewayDecisionRows,
    (row) => row.allowedCount,
  );
  const deniedGatewayDecisions = sum(
    input.gatewayDecisionRows,
    (row) => row.deniedCount,
  );
  const qualityErrors = sum(input.qualityRows, (row) => row.qualityErrorCount);
  const sharedServiceFailures = sum(
    input.sharedServiceUsageRows,
    (row) => row.failureCount,
  );
  const estimatedCostUsd = roundCurrency(
    sum(input.costRows, (row) => row.estimatedCostUsd),
  );
  const openDecisionSignals = input.decisionSignalRows.filter(
    (row) => row.status === "open" || row.status === "blocked",
  ).length;

  const questions: NorthStarQuestion[] = [
    {
      key: "ownership",
      label: "Who produced what?",
      answer:
        uniqueTribes > 0
          ? `${uniqueTribes} tribe(s), ${uniqueSourceServices} source service(s), and ${totalEvents} event(s) are visible in curated rows.`
          : "No curated tribe or service attribution is visible for this partition.",
      status: uniqueTribes > 0 && totalEvents > 0 ? "complete" : "missing",
      evidenceCount: input.healthRows.length,
    },
    {
      key: "gateway",
      label: "Was it allowed?",
      answer:
        input.gatewayDecisionRows.length > 0
          ? `${allowedGatewayDecisions} allowed and ${deniedGatewayDecisions} denied gateway decision(s) are visible.`
          : "No gateway decision rows are visible for this partition.",
      status:
        input.gatewayDecisionRows.length === 0
          ? "missing"
          : deniedGatewayDecisions > 0
            ? "warning"
            : "complete",
      evidenceCount: input.gatewayDecisionRows.length,
    },
    {
      key: "export",
      label: "Did events land and curate?",
      answer:
        input.healthRows.length > 0
          ? `${input.healthRows.length} pipeline-health row(s) show event arrival and curated Gold evidence.`
          : "No pipeline-health row is available for event landing or curation evidence.",
      status: input.healthRows.length > 0 ? "complete" : "missing",
      evidenceCount: input.healthRows.length,
    },
    {
      key: "quality",
      label: "Is the data usable?",
      answer:
        input.qualityRows.length > 0
          ? `${qualityErrors} quality error(s) and ${openDecisionSignals} open decision signal(s) need review.`
          : "No quality rows are visible for this partition.",
      status:
        input.qualityRows.length === 0
          ? "missing"
          : qualityErrors > 0 || openDecisionSignals > 0
            ? "warning"
            : "complete",
      evidenceCount: input.qualityRows.length + input.decisionSignalRows.length,
    },
    {
      key: "cost",
      label: "How much did it cost to query?",
      answer:
        input.costRows.length > 0
          ? `$${estimatedCostUsd.toFixed(2)} estimated Athena scan cost is visible for this partition.`
          : "No Athena query-cost telemetry is visible for this partition.",
      status: input.costRows.length > 0 ? "complete" : "missing",
      evidenceCount: input.costRows.length,
    },
    {
      key: "visualization",
      label: "Is the BI view connected?",
      answer: input.powerBiEnabled
        ? "The governed Power BI report is configured for this management environment."
        : "Power BI embed is not configured in this management environment.",
      status: input.powerBiEnabled ? "complete" : "missing",
      evidenceCount: input.powerBiEnabled ? 1 : 0,
    },
  ];

  const missingCount = questions.filter((question) => question.status === "missing").length;
  const warningCount = questions.filter((question) => question.status === "warning").length;
  const status: NorthStarStatus =
    totalEvents === 0 && missingCount === questions.length
      ? "missing"
      : warningCount > 0 || missingCount > 0
        ? "warning"
        : "complete";

  return {
    status,
    answer: northStarAnswer(status),
    metrics: {
      totalEvents,
      uniqueTribes,
      uniqueSourceServices,
      allowedGatewayDecisions,
      deniedGatewayDecisions,
      qualityErrors,
      sharedServiceFailures,
      estimatedCostUsd,
      openDecisionSignals,
      powerBiConfigured: input.powerBiEnabled,
    },
    questions,
  };
}

function northStarAnswer(status: NorthStarStatus) {
  if (status === "complete") {
    return "Traceable: this partition has native evidence for ownership, gateway decisions, export health, quality, cost, and visualization.";
  }

  if (status === "warning") {
    return "Partially traceable: curated evidence exists, but one or more supporting questions need operator review.";
  }

  return "Not enough curated evidence is available to answer the north-star question for this partition.";
}

function sum<T>(rows: T[], select: (row: T) => number | undefined) {
  return rows.reduce((total, row) => total + (select(row) ?? 0), 0);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
```

- [ ] **Step 4: Verify summary tests pass**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/data-pipeline/north-star-summary.test.ts
```

Expected: all summary tests pass.

- [ ] **Step 5: Commit Phase 2**

Run:

```powershell
cd C:\Codes\apic
git add apicenter-management/src/lib/data-pipeline/north-star-summary.ts apicenter-management/src/lib/data-pipeline/north-star-summary.test.ts
git commit -m "feat: summarize north-star pipeline evidence"
```

---

## Phase 3: Native North-Star UI Panel

**Purpose:** Show the answer and supporting questions at the top of `/data-pipeline` before detailed tables.

**Files:**
- Create: `apicenter-management/src/components/north-star-summary-panel.tsx`
- Create: `apicenter-management/src/components/north-star-summary-panel.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `src/components/north-star-summary-panel.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NorthStarSummaryPanel } from "./north-star-summary-panel";
import type { NorthStarSummary } from "@/lib/data-pipeline/north-star-summary";

const summary: NorthStarSummary = {
  status: "warning",
  answer:
    "Partially traceable: curated evidence exists, but one or more supporting questions need operator review.",
  metrics: {
    totalEvents: 12,
    uniqueTribes: 1,
    uniqueSourceServices: 1,
    allowedGatewayDecisions: 5,
    deniedGatewayDecisions: 1,
    qualityErrors: 0,
    sharedServiceFailures: 0,
    estimatedCostUsd: 0.01,
    openDecisionSignals: 1,
    powerBiConfigured: false,
  },
  questions: [
    {
      key: "ownership",
      label: "Who produced what?",
      answer: "1 tribe is visible.",
      status: "complete",
      evidenceCount: 1,
    },
    {
      key: "visualization",
      label: "Is the BI view connected?",
      answer: "Power BI embed is not configured.",
      status: "missing",
      evidenceCount: 0,
    },
  ],
};

describe("NorthStarSummaryPanel", () => {
  afterEach(() => cleanup());

  it("renders the north-star answer and metric totals", () => {
    render(<NorthStarSummaryPanel summary={summary} />);

    expect(screen.getByText("North-star answer")).toBeTruthy();
    expect(screen.getByText(/Partially traceable/)).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Total events")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("Open signals")).toBeTruthy();
  });

  it("renders supporting questions with status labels", () => {
    render(<NorthStarSummaryPanel summary={summary} />);

    expect(screen.getByText("Who produced what?")).toBeTruthy();
    expect(screen.getByText("Is the BI view connected?")).toBeTruthy();
    expect(screen.getByText("Missing")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run failing component tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/north-star-summary-panel.test.tsx
```

Expected: fail because `north-star-summary-panel.tsx` does not exist.

- [ ] **Step 3: Implement summary panel**

Create `src/components/north-star-summary-panel.tsx`:

```tsx
"use client";

import { AlertTriangleIcon, CheckCircle2Icon, CircleDashedIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  NorthStarStatus,
  NorthStarSummary,
} from "@/lib/data-pipeline/north-star-summary";

export function NorthStarSummaryPanel({ summary }: { summary: NorthStarSummary }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>North-star answer</CardTitle>
            <CardDescription>
              Trace tribe request, gateway decision, event export, cost, and BI readiness.
            </CardDescription>
          </div>
          <NorthStarStatusBadge status={summary.status} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="max-w-4xl text-sm leading-6 text-muted-foreground">
          {summary.answer}
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Total events" value={summary.metrics.totalEvents} />
          <Metric label="Tribes" value={summary.metrics.uniqueTribes} />
          <Metric
            label="Denied gateway decisions"
            value={summary.metrics.deniedGatewayDecisions}
          />
          <Metric label="Open signals" value={summary.metrics.openDecisionSignals} />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {summary.questions.map((question) => (
            <div key={question.key} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">{question.label}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{question.answer}</p>
                </div>
                <NorthStarStatusBadge status={question.status} compact />
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                {question.evidenceCount} evidence row(s)
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function NorthStarStatusBadge({
  status,
  compact = false,
}: {
  status: NorthStarStatus;
  compact?: boolean;
}) {
  if (status === "complete") {
    return (
      <Badge className="bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]">
        <CheckCircle2Icon data-icon="inline-start" />
        {compact ? "Ready" : "Traceable"}
      </Badge>
    );
  }

  if (status === "warning") {
    return (
      <Badge variant="outline">
        <AlertTriangleIcon data-icon="inline-start" />
        Review
      </Badge>
    );
  }

  return (
    <Badge variant="secondary">
      <CircleDashedIcon data-icon="inline-start" />
      Missing
    </Badge>
  );
}
```

- [ ] **Step 4: Verify summary panel tests pass**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/north-star-summary-panel.test.tsx
```

Expected: all summary panel tests pass.

- [ ] **Step 5: Commit Phase 3**

Run:

```powershell
cd C:\Codes\apic
git add apicenter-management/src/components/north-star-summary-panel.tsx apicenter-management/src/components/north-star-summary-panel.test.tsx
git commit -m "feat: add north-star summary panel"
```

---

## Phase 4: Guarded Power BI Embed Panel

**Purpose:** Add the optional embedded report without making Power BI a hard dependency for local/test environments.

**Files:**
- Create: `apicenter-management/src/components/powerbi-embed-panel.tsx`
- Create: `apicenter-management/src/components/powerbi-embed-panel.test.tsx`

- [ ] **Step 1: Write failing embed panel tests**

Create `src/components/powerbi-embed-panel.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PowerBiEmbedPanel } from "./powerbi-embed-panel";

describe("PowerBiEmbedPanel", () => {
  afterEach(() => cleanup());

  it("shows an empty state when the embed is not configured", () => {
    render(<PowerBiEmbedPanel config={{ enabled: false }} />);

    expect(screen.getByText("Power BI report not configured")).toBeTruthy();
    expect(screen.queryByTitle("APICenter north-star Power BI report")).toBeNull();
  });

  it("renders a guarded iframe when configured", () => {
    render(
      <PowerBiEmbedPanel
        config={{
          enabled: true,
          embedUrl: "https://app.powerbi.com/reportEmbed?reportId=abc",
          reportId: "north-star",
        }}
      />,
    );

    const frame = screen.getByTitle("APICenter north-star Power BI report");
    expect(frame).toHaveAttribute(
      "src",
      "https://app.powerbi.com/reportEmbed?reportId=abc",
    );
    expect(frame).toHaveAttribute("loading", "lazy");
  });
});
```

- [ ] **Step 2: Run failing embed panel tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/powerbi-embed-panel.test.tsx
```

Expected: fail because `powerbi-embed-panel.tsx` does not exist.

- [ ] **Step 3: Implement embed panel**

Create `src/components/powerbi-embed-panel.tsx`:

```tsx
"use client";

import { BarChart3Icon, ExternalLinkIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { NorthStarPowerBiConfig } from "@/lib/server/north-star-powerbi-config";

export function PowerBiEmbedPanel({
  config,
}: {
  config: NorthStarPowerBiConfig;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Power BI north-star dashboard</CardTitle>
        <CardDescription>
          Governed BI view over Gold or materialized platform outputs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!config.enabled || !config.embedUrl ? (
          <Alert>
            <BarChart3Icon data-icon="inline-start" />
            <AlertTitle>Power BI report not configured</AlertTitle>
            <AlertDescription>
              Set POWERBI_NORTH_STAR_ENABLED=true and POWERBI_NORTH_STAR_EMBED_URL
              for this management environment after the report points to governed
              Gold or materialized outputs.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-lg border bg-muted">
              <iframe
                title="APICenter north-star Power BI report"
                src={config.embedUrl}
                className="h-[720px] w-full bg-background"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allow="fullscreen"
              />
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ExternalLinkIcon className="size-3" />
              Report id: {config.reportId ?? "not recorded in environment"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Verify embed panel tests pass**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/powerbi-embed-panel.test.tsx
```

Expected: all embed panel tests pass.

- [ ] **Step 5: Commit Phase 4**

Run:

```powershell
cd C:\Codes\apic
git add apicenter-management/src/components/powerbi-embed-panel.tsx apicenter-management/src/components/powerbi-embed-panel.test.tsx
git commit -m "feat: add guarded powerbi embed panel"
```

---

## Phase 5: Wire Tabs Into `/data-pipeline`

**Purpose:** Make the page answer the north-star question first, then provide multiple views for supporting evidence.

**Files:**
- Modify: `apicenter-management/src/app/data-pipeline/page.tsx`
- Modify: `apicenter-management/src/components/data-pipeline-dashboard-client.tsx`
- Create: `apicenter-management/src/components/data-pipeline-dashboard-client.test.tsx`

- [ ] **Step 1: Write failing dashboard composition test**

Create `src/components/data-pipeline-dashboard-client.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataPipelineDashboardClient } from "./data-pipeline-dashboard-client";

vi.mock("@/lib/api-center-client", () => ({
  getDataPipelineHealth: vi.fn(async () => [
    {
      environment: "test",
      tribeId: "codex",
      eventType: "codex.pipeline.flush",
      eventDay: "2026-05-20",
      eventCount: 1,
    },
  ]),
  getDataPipelineQuality: vi.fn(async () => []),
  getDataPipelineSharedServiceUsage: vi.fn(async () => []),
  getDataPipelineGatewayDecisions: vi.fn(async () => []),
  getDataPipelineCost: vi.fn(async () => []),
  getDataPipelineDecisionSignals: vi.fn(async () => []),
}));

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DataPipelineDashboardClient
        powerBiConfig={{
          enabled: false,
        }}
      />
    </QueryClientProvider>,
  );
}

describe("DataPipelineDashboardClient", () => {
  afterEach(() => cleanup());

  it("shows the north-star summary and supporting view tabs", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("North-star answer")).toBeTruthy();
    });

    expect(screen.getByRole("tab", { name: "Traceability" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Governance" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Cost" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "BI" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run failing dashboard composition test**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/data-pipeline-dashboard-client.test.tsx
```

Expected: fail because the dashboard does not accept `powerBiConfig` and does not render north-star tabs.

- [ ] **Step 3: Pass server config from the page**

Modify `src/app/data-pipeline/page.tsx`:

```tsx
import { DataPipelineDashboardClient } from "@/components/data-pipeline-dashboard-client";
import { PageHeading } from "@/components/page-heading";
import { getNorthStarPowerBiConfig } from "@/lib/server/north-star-powerbi-config";

export default function DataPipelinePage() {
  const powerBiConfig = getNorthStarPowerBiConfig();

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Data pipeline"
        description="Answer the north-star traceability question across publishing, gateway decisions, S3 export, governed BI, and Athena cost signals."
      />
      <DataPipelineDashboardClient powerBiConfig={powerBiConfig} />
    </div>
  );
}
```

- [ ] **Step 4: Wire the client dashboard**

Modify `src/components/data-pipeline-dashboard-client.tsx` so it:

1. Accepts `powerBiConfig`.
2. Builds a `northStarSummary`.
3. Renders `NorthStarSummaryPanel`.
4. Renders native views inside tabs.
5. Puts Power BI inside the `BI` tab.

Use this component shape:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getDataPipelineCost,
  getDataPipelineDecisionSignals,
  getDataPipelineGatewayDecisions,
  getDataPipelineHealth,
  getDataPipelineQuality,
  getDataPipelineSharedServiceUsage,
} from "@/lib/api-center-client";
import { buildNorthStarSummary } from "@/lib/data-pipeline/north-star-summary";
import { queryKeys } from "@/lib/query-keys";
import type {
  PipelineHealthEnvironment,
  PipelinePartitionDate,
} from "@/lib/schemas";
import type { NorthStarPowerBiConfig } from "@/lib/server/north-star-powerbi-config";
import { DataPipelineCostPanel } from "@/components/data-pipeline-cost-panel";
import { DataPipelineGovernancePanel } from "@/components/data-pipeline-governance-panel";
import { DataPipelineHealthPanel } from "@/components/data-pipeline-health-panel";
import { NorthStarSummaryPanel } from "@/components/north-star-summary-panel";
import { PowerBiEmbedPanel } from "@/components/powerbi-embed-panel";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

export function DataPipelineDashboardClient({
  powerBiConfig,
}: {
  powerBiConfig: NorthStarPowerBiConfig;
}) {
  const [environment, setEnvironment] =
    useState<PipelineHealthEnvironment>("test");
  const [partitionValue, setPartitionValue] = useState(currentUtcDateInput());
  const partition = dateInputToPartition(partitionValue);
  const partitionKey = partition
    ? `${partition.year}-${partition.month}-${partition.day}`
    : "current";

  const healthQuery = useQuery({
    queryKey: queryKeys.dataPipelineHealth(environment, partitionKey),
    queryFn: () => getDataPipelineHealth(environment, partition),
    retry: 1,
  });
  const qualityQuery = useQuery({
    queryKey: queryKeys.dataPipelineQuality(environment, partitionKey),
    queryFn: () => getDataPipelineQuality(environment, partition),
    retry: 1,
  });
  const sharedServiceUsageQuery = useQuery({
    queryKey: queryKeys.dataPipelineSharedServiceUsage(environment, partitionKey),
    queryFn: () => getDataPipelineSharedServiceUsage(environment, partition),
    retry: 1,
  });
  const gatewayDecisionQuery = useQuery({
    queryKey: queryKeys.dataPipelineGatewayDecisions(environment, partitionKey),
    queryFn: () => getDataPipelineGatewayDecisions(environment, partition),
    retry: 1,
  });
  const costQuery = useQuery({
    queryKey: queryKeys.dataPipelineCost(environment, partitionKey),
    queryFn: () => getDataPipelineCost(environment, partition),
    retry: 1,
  });
  const decisionSignalQuery = useQuery({
    queryKey: queryKeys.dataPipelineDecisionSignals(environment, partitionKey),
    queryFn: () => getDataPipelineDecisionSignals(environment, partition),
    retry: 1,
  });

  const healthRows = healthQuery.data ?? [];
  const qualityRows = qualityQuery.data ?? [];
  const sharedServiceUsageRows = sharedServiceUsageQuery.data ?? [];
  const gatewayDecisionRows = gatewayDecisionQuery.data ?? [];
  const costRows = costQuery.data ?? [];
  const decisionSignalRows = decisionSignalQuery.data ?? [];

  const northStarSummary = useMemo(
    () =>
      buildNorthStarSummary({
        healthRows,
        qualityRows,
        sharedServiceUsageRows,
        gatewayDecisionRows,
        costRows,
        decisionSignalRows,
        powerBiEnabled: powerBiConfig.enabled,
      }),
    [
      healthRows,
      qualityRows,
      sharedServiceUsageRows,
      gatewayDecisionRows,
      costRows,
      decisionSignalRows,
      powerBiConfig.enabled,
    ],
  );

  const governanceLoading =
    qualityQuery.isLoading ||
    qualityQuery.isFetching ||
    sharedServiceUsageQuery.isLoading ||
    sharedServiceUsageQuery.isFetching ||
    gatewayDecisionQuery.isLoading ||
    gatewayDecisionQuery.isFetching ||
    decisionSignalQuery.isLoading ||
    decisionSignalQuery.isFetching;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={environment === "test" ? "default" : "outline"}
          onClick={() => setEnvironment("test")}
        >
          Test
        </Button>
        <Button
          type="button"
          variant={environment === "prod" ? "default" : "outline"}
          onClick={() => setEnvironment("prod")}
        >
          Prod
        </Button>
        <input
          aria-label="Pipeline partition date"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          type="date"
          value={partitionValue}
          onChange={(event) => setPartitionValue(event.target.value)}
        />
      </div>

      <NorthStarSummaryPanel summary={northStarSummary} />

      <Tabs defaultValue="traceability">
        <TabsList className="flex w-full flex-wrap justify-start" variant="line">
          <TabsTrigger value="traceability">Traceability</TabsTrigger>
          <TabsTrigger value="governance">Governance</TabsTrigger>
          <TabsTrigger value="cost">Cost</TabsTrigger>
          <TabsTrigger value="bi">BI</TabsTrigger>
        </TabsList>
        <TabsContent value="traceability" className="mt-4">
          <DataPipelineHealthPanel
            rows={healthRows}
            loading={healthQuery.isLoading || healthQuery.isFetching}
          />
        </TabsContent>
        <TabsContent value="governance" className="mt-4">
          <DataPipelineGovernancePanel
            qualityRows={qualityRows}
            sharedServiceUsageRows={sharedServiceUsageRows}
            gatewayDecisionRows={gatewayDecisionRows}
            decisionSignalRows={decisionSignalRows}
            loading={governanceLoading}
          />
        </TabsContent>
        <TabsContent value="cost" className="mt-4">
          <DataPipelineCostPanel
            rows={costRows}
            loading={costQuery.isLoading || costQuery.isFetching}
          />
        </TabsContent>
        <TabsContent value="bi" className="mt-4">
          <PowerBiEmbedPanel config={powerBiConfig} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function currentUtcDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function dateInputToPartition(value: string): PipelinePartitionDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return {
    year: match[1],
    month: match[2],
    day: match[3],
  };
}
```

- [ ] **Step 5: Verify dashboard tests pass**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/data-pipeline-dashboard-client.test.tsx
```

Expected: the dashboard composition test passes.

- [ ] **Step 6: Run focused component test suite**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/server/north-star-powerbi-config.test.ts src/lib/data-pipeline/north-star-summary.test.ts src/components/north-star-summary-panel.test.tsx src/components/powerbi-embed-panel.test.tsx src/components/data-pipeline-dashboard-client.test.tsx src/components/data-pipeline-health-panel.test.tsx src/components/data-pipeline-governance-panel.test.tsx src/components/data-pipeline-cost-panel.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit Phase 5**

Run:

```powershell
cd C:\Codes\apic
git add apicenter-management/src/app/data-pipeline/page.tsx apicenter-management/src/components/data-pipeline-dashboard-client.tsx apicenter-management/src/components/data-pipeline-dashboard-client.test.tsx
git commit -m "feat: add north-star data pipeline views"
```

---

## Phase 6: Documentation And BI Governance Updates

**Purpose:** Make the Power BI/reporting rules explicit for platform team members so the embed does not drift into raw S3 or wrong-environment reporting.

**Files:**
- Modify: `api-center/docs/data-pipeline/platform-team-north-star-bi-plan.md`
- Modify: `api-center/docs/data-pipeline/bi-handoff-runbook.md`

- [ ] **Step 1: Update north-star BI plan**

Add this section to `api-center/docs/data-pipeline/platform-team-north-star-bi-plan.md` after the Power BI/modeling section:

```markdown
## Management Console Embed

The `apicenter-management` `/data-pipeline` page can embed the approved Power BI
north-star report after the report is connected to governed Gold or
`materialized_platform.*` outputs.

Required management environment variables:

```text
POWERBI_NORTH_STAR_ENABLED=true
POWERBI_NORTH_STAR_REPORT_ID=<approved-report-id>
POWERBI_NORTH_STAR_EMBED_URL=<https-powerbi-report-embed-url>
```

The embedded report must have these pages or equivalent visual groups:

| View | Question answered | Required source |
| --- | --- | --- |
| Traceability | Who called what and what event was produced? | Gold or materialized platform health and gateway outputs |
| Governance | Was it allowed, denied, invalid, or flagged? | Gold quality, gateway decision, and decision signal outputs |
| Export | Did the event land and curate from raw through Gold? | Pipeline-health Gold/materialized output |
| Cost | Which refreshes or queries are expensive? | Athena cost Gold/materialized output |
| Supporting detail | Which tribe, service, event type, and date need review? | Approved Gold or Common Silver detail with bounded partitions |

Do not embed a report that reads Raw S3 or broad unbounded Athena views.
```

- [ ] **Step 2: Update BI handoff runbook**

Add this section to `api-center/docs/data-pipeline/bi-handoff-runbook.md` after `BI Connection Pattern`:

```markdown
## Power BI Embed In Management Console

The management console may embed the approved APICenter north-star Power BI
report as a read-only operator view.

Embed approval checklist:

- The report uses Gold or materialized outputs as its dataset source.
- The report does not connect to Raw S3.
- The report has separate test and prod workspaces, datasets, or parameters.
- The visible report page labels the environment.
- Scheduled refresh cadence and scan budget are recorded in the BI inventory.
- The report owner and data steward are recorded.
- The management deployment stores only the report embed URL and report id.
- No Power BI client secret, AWS key, or Athena credential is exposed to the
  browser.

If any checklist item is not satisfied, leave
`POWERBI_NORTH_STAR_ENABLED=false` and use the native `/data-pipeline` views
until the report is approved.
```

- [ ] **Step 3: Commit Phase 6**

Run:

```powershell
cd C:\Codes\apic
git add api-center/docs/data-pipeline/platform-team-north-star-bi-plan.md api-center/docs/data-pipeline/bi-handoff-runbook.md
git commit -m "docs: add north-star powerbi embed rules"
```

---

## Phase 7: Final Verification

**Purpose:** Prove the management UI still builds and the documentation aligns with the governed APICenter analytics model.

**Files:**
- No additional file edits unless verification finds issues.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/server/north-star-powerbi-config.test.ts src/lib/data-pipeline/north-star-summary.test.ts src/components/north-star-summary-panel.test.tsx src/components/powerbi-embed-panel.test.tsx src/components/data-pipeline-dashboard-client.test.tsx src/components/data-pipeline-health-panel.test.tsx src/components/data-pipeline-governance-panel.test.tsx src/components/data-pipeline-cost-panel.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run typecheck
```

Expected: TypeScript passes.

- [ ] **Step 3: Run production build**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run build
```

Expected: Next.js build succeeds and includes `/data-pipeline`.

- [ ] **Step 4: Run local visual smoke**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run dev
```

Open:

```text
http://localhost:3000/data-pipeline
```

Expected:

- The page shows the north-star answer above the detail panels.
- Test/prod and date controls still work.
- `Traceability`, `Governance`, `Cost`, and `BI` tabs are visible.
- With Power BI env disabled, the `BI` tab shows the unconfigured state.
- With a valid HTTPS Power BI embed URL in local env, the `BI` tab renders the iframe.
- No raw S3 bucket path is presented as a BI source.

- [ ] **Step 5: Commit verification fixes if needed**

If verification requires fixes, commit them:

```powershell
cd C:\Codes\apic
git add apicenter-management api-center/docs/data-pipeline
git commit -m "fix: harden north-star analytics dashboard"
```

Expected: no commit is needed if all prior phases passed cleanly.

---

## Rollout Notes

- Start with `POWERBI_NORTH_STAR_ENABLED=false` in test and live.
- Deploy the native north-star summary first because it depends only on existing APICenter APIs.
- Enable the Power BI iframe in the test management deployment only after the report uses governed Gold or materialized outputs.
- Enable the Power BI iframe in live only after the BI handoff checklist is satisfied for prod.
- Keep native tables available even after Power BI is embedded; they are the operator evidence and action surface.

## Out Of Scope

- Creating the Power BI report itself.
- Creating Azure AD service-principal embed-token generation.
- Granting BI users raw S3 or broad Athena access.
- Adding new APICenter backend data-pipeline endpoints.
- Changing Athena Gold SQL definitions.

## Acceptance Criteria

- `/data-pipeline` answers the north-star question in native UI without requiring Power BI.
- `/data-pipeline` has multiple supporting views: traceability, governance, cost, and BI.
- Power BI embed is optional, disabled by default, and controlled by server-side env.
- Power BI embed uses only an HTTPS `powerbi.com` iframe URL.
- Tests cover config parsing, summary logic, summary rendering, embed rendering, and dashboard composition.
- Docs state that Power BI reads governed Gold/materialized outputs, not Raw S3.
- Typecheck and build pass in `apicenter-management`.
