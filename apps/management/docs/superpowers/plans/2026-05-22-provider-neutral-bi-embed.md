# Provider-Neutral BI Embed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the current Power BI-only north-star embed into a provider-neutral BI embed that can render Power BI, Looker, or Looker Studio while keeping APICenter's governed Gold/materialized data rules intact.

**Architecture:** Keep the `/data-pipeline` native APICenter summary and evidence tables as the source-of-truth operator view. Replace Power BI-specific config/component names with generic BI config/component names, allow a constrained provider enum, and validate each embed URL against provider-specific HTTPS host rules. Keep `POWERBI_NORTH_STAR_*` as a backwards-compatible fallback so existing deployments do not break during migration.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, TanStack Query, shadcn/base-ui tabs, lucide-react, Vitest, Testing Library, environment-variable based configuration, iframe embeds for approved BI providers.

---

## Current Baseline

The current implementation is working but Power BI-specific:

| Current file | Current role | Change direction |
| --- | --- | --- |
| `src/lib/server/north-star-powerbi-config.ts` | Reads `POWERBI_NORTH_STAR_*` and only allows `powerbi.com` hosts. | Replace with `north-star-bi-config.ts` using `BI_NORTH_STAR_*`, provider enum, host validation, and Power BI fallback. |
| `src/components/powerbi-embed-panel.tsx` | Renders Power BI iframe or Power BI-specific empty state. | Replace with `bi-embed-panel.tsx` that renders provider-aware copy and iframe title. |
| `src/components/data-pipeline-dashboard-client.tsx` | Accepts `powerBiConfig` and passes it to the Power BI panel. | Accept `biConfig`, use it in summary and BI tab. |
| `src/app/data-pipeline/page.tsx` | Calls `getNorthStarPowerBiConfig()`. | Call `getNorthStarBiConfig()`. |
| `.env.example` | Documents `POWERBI_NORTH_STAR_*`. | Add generic `BI_NORTH_STAR_*`; keep legacy Power BI variables under migration notes. |
| `api-center/docs/data-pipeline/*.md` | Says Power BI in the embed rules. | Update language to Power BI or Looker while preserving governed-source requirements. |

Provider definitions for v1:

| Provider value | Intended product | Allowed embed host examples |
| --- | --- | --- |
| `powerbi` | Microsoft Power BI secure report embed | `app.powerbi.com`, subdomains ending in `powerbi.com` |
| `looker` | Looker governed dashboard embed from an organization instance | Host ending in the configured `BI_NORTH_STAR_ALLOWED_HOST` or `LOOKER_NORTH_STAR_ALLOWED_HOST` |
| `looker-studio` | Looker Studio report embed | `lookerstudio.google.com`, `datastudio.google.com` |

Do not support public, arbitrary iframe URLs.

---

## Planned File Structure

| Path | Purpose |
| --- | --- |
| `apicenter-management/.env.example` | Document generic BI embed variables and legacy Power BI fallback. |
| `apicenter-management/src/lib/server/north-star-bi-config.ts` | New generic config reader and provider-aware URL validator. |
| `apicenter-management/src/lib/server/north-star-bi-config.test.ts` | Tests for disabled config, Power BI, Looker Studio, Looker custom host, invalid host, and legacy fallback. |
| `apicenter-management/src/lib/server/north-star-powerbi-config.ts` | Remove after all imports move, or keep as a short deprecated re-export only if needed. |
| `apicenter-management/src/lib/server/north-star-powerbi-config.test.ts` | Remove after generic tests cover fallback behavior. |
| `apicenter-management/src/components/bi-embed-panel.tsx` | New provider-neutral iframe/empty-state panel. |
| `apicenter-management/src/components/bi-embed-panel.test.tsx` | Tests for provider labels, unconfigured state, and iframe rendering. |
| `apicenter-management/src/components/powerbi-embed-panel.tsx` | Remove after dashboard imports move. |
| `apicenter-management/src/components/powerbi-embed-panel.test.tsx` | Remove after generic panel tests exist. |
| `apicenter-management/src/components/data-pipeline-dashboard-client.tsx` | Rename prop from `powerBiConfig` to `biConfig`, pass provider-neutral config. |
| `apicenter-management/src/components/data-pipeline-dashboard-client.test.tsx` | Update test props and assertions for provider-neutral BI tab. |
| `apicenter-management/src/app/data-pipeline/page.tsx` | Use `getNorthStarBiConfig()`. |
| `apicenter-management/src/lib/data-pipeline/north-star-summary.ts` | Rename `powerBiConfigured` metric to `biConfigured`, with backwards-safe UI wording. |
| `apicenter-management/src/lib/data-pipeline/north-star-summary.test.ts` | Update summary tests for generic BI. |
| `api-center/docs/data-pipeline/platform-team-north-star-bi-plan.md` | Update embed section to mention Power BI or Looker. |
| `api-center/docs/data-pipeline/bi-handoff-runbook.md` | Update embed checklist for provider-neutral BI. |

---

## Phase 0: Baseline And Branch Safety

**Purpose:** Confirm the current pushed management `main` is clean and verify the existing north-star UI before refactoring it.

**Files:**
- No file edits.

- [ ] **Step 1: Confirm management repo state**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
git status --short --branch
git branch --show-current
```

Expected:

```text
## main...origin/main
main
```

- [ ] **Step 2: Create a feature branch**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
git switch -c provider-neutral-bi-embed
```

Expected:

```text
Switched to a new branch 'provider-neutral-bi-embed'
```

- [ ] **Step 3: Run current focused tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/server/north-star-powerbi-config.test.ts src/lib/data-pipeline/north-star-summary.test.ts src/components/powerbi-embed-panel.test.tsx src/components/data-pipeline-dashboard-client.test.tsx
```

Expected: existing tests pass before refactor.

---

## Phase 1: Generic BI Config Reader

**Purpose:** Introduce provider-neutral config without breaking current `POWERBI_NORTH_STAR_*` deployments.

**Files:**
- Create: `apicenter-management/src/lib/server/north-star-bi-config.ts`
- Create: `apicenter-management/src/lib/server/north-star-bi-config.test.ts`
- Remove later: `apicenter-management/src/lib/server/north-star-powerbi-config.ts`
- Remove later: `apicenter-management/src/lib/server/north-star-powerbi-config.test.ts`

- [ ] **Step 1: Write failing generic config tests**

Create `src/lib/server/north-star-bi-config.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getNorthStarBiConfig } from "./north-star-bi-config";

describe("getNorthStarBiConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled when BI_NORTH_STAR_ENABLED is not true", () => {
    vi.stubEnv("BI_NORTH_STAR_ENABLED", "false");
    vi.stubEnv("BI_NORTH_STAR_PROVIDER", "looker-studio");
    vi.stubEnv(
      "BI_NORTH_STAR_EMBED_URL",
      "https://lookerstudio.google.com/embed/reporting/report-id/page/page-id",
    );

    expect(getNorthStarBiConfig()).toEqual({
      enabled: false,
      provider: "none",
      embedUrl: undefined,
      dashboardId: undefined,
      allowedHost: undefined,
    });
  });

  it("accepts a Looker Studio embed URL", () => {
    vi.stubEnv("BI_NORTH_STAR_ENABLED", "true");
    vi.stubEnv("BI_NORTH_STAR_PROVIDER", "looker-studio");
    vi.stubEnv("BI_NORTH_STAR_DASHBOARD_ID", "studio-report");
    vi.stubEnv(
      "BI_NORTH_STAR_EMBED_URL",
      "https://lookerstudio.google.com/embed/reporting/report-id/page/page-id",
    );

    expect(getNorthStarBiConfig()).toEqual({
      enabled: true,
      provider: "looker-studio",
      embedUrl:
        "https://lookerstudio.google.com/embed/reporting/report-id/page/page-id",
      dashboardId: "studio-report",
      allowedHost: undefined,
    });
  });

  it("accepts a Looker instance when the allowed host matches", () => {
    vi.stubEnv("BI_NORTH_STAR_ENABLED", "true");
    vi.stubEnv("BI_NORTH_STAR_PROVIDER", "looker");
    vi.stubEnv("BI_NORTH_STAR_DASHBOARD_ID", "42");
    vi.stubEnv("BI_NORTH_STAR_ALLOWED_HOST", "analytics.example.com");
    vi.stubEnv(
      "BI_NORTH_STAR_EMBED_URL",
      "https://analytics.example.com/embed/dashboards/42",
    );

    expect(getNorthStarBiConfig()).toEqual({
      enabled: true,
      provider: "looker",
      embedUrl: "https://analytics.example.com/embed/dashboards/42",
      dashboardId: "42",
      allowedHost: "analytics.example.com",
    });
  });

  it("rejects a Looker instance when the allowed host is missing", () => {
    vi.stubEnv("BI_NORTH_STAR_ENABLED", "true");
    vi.stubEnv("BI_NORTH_STAR_PROVIDER", "looker");
    vi.stubEnv(
      "BI_NORTH_STAR_EMBED_URL",
      "https://analytics.example.com/embed/dashboards/42",
    );

    expect(getNorthStarBiConfig()).toMatchObject({
      enabled: false,
      provider: "looker",
      embedUrl: undefined,
    });
  });

  it("accepts a Power BI secure embed URL", () => {
    vi.stubEnv("BI_NORTH_STAR_ENABLED", "true");
    vi.stubEnv("BI_NORTH_STAR_PROVIDER", "powerbi");
    vi.stubEnv("BI_NORTH_STAR_DASHBOARD_ID", "powerbi-report");
    vi.stubEnv(
      "BI_NORTH_STAR_EMBED_URL",
      "https://app.powerbi.com/reportEmbed?reportId=abc",
    );

    expect(getNorthStarBiConfig()).toEqual({
      enabled: true,
      provider: "powerbi",
      embedUrl: "https://app.powerbi.com/reportEmbed?reportId=abc",
      dashboardId: "powerbi-report",
      allowedHost: undefined,
    });
  });

  it("keeps backwards compatibility with POWERBI_NORTH_STAR variables", () => {
    vi.stubEnv("POWERBI_NORTH_STAR_ENABLED", "true");
    vi.stubEnv("POWERBI_NORTH_STAR_REPORT_ID", "legacy-report");
    vi.stubEnv(
      "POWERBI_NORTH_STAR_EMBED_URL",
      "https://app.powerbi.com/reportEmbed?reportId=abc",
    );

    expect(getNorthStarBiConfig()).toEqual({
      enabled: true,
      provider: "powerbi",
      embedUrl: "https://app.powerbi.com/reportEmbed?reportId=abc",
      dashboardId: "legacy-report",
      allowedHost: undefined,
    });
  });
});
```

- [ ] **Step 2: Run failing generic config tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/server/north-star-bi-config.test.ts
```

Expected: fail because `north-star-bi-config.ts` does not exist.

- [ ] **Step 3: Implement generic config reader**

Create `src/lib/server/north-star-bi-config.ts`:

```ts
export type NorthStarBiProvider =
  | "none"
  | "powerbi"
  | "looker"
  | "looker-studio";

export type NorthStarBiConfig = {
  enabled: boolean;
  provider: NorthStarBiProvider;
  embedUrl?: string;
  dashboardId?: string;
  allowedHost?: string;
};

export function getNorthStarBiConfig(
  env: NodeJS.ProcessEnv = process.env,
): NorthStarBiConfig {
  const provider = readProvider(env);
  const enabled = readEnabled(env);
  const dashboardId = cleanOptional(
    env.BI_NORTH_STAR_DASHBOARD_ID ?? env.POWERBI_NORTH_STAR_REPORT_ID,
  );
  const embedUrl = cleanOptional(
    env.BI_NORTH_STAR_EMBED_URL ?? env.POWERBI_NORTH_STAR_EMBED_URL,
  );
  const allowedHost = normalizeHost(
    env.BI_NORTH_STAR_ALLOWED_HOST ?? env.LOOKER_NORTH_STAR_ALLOWED_HOST,
  );

  if (!enabled || !embedUrl || !isAllowedEmbedUrl(provider, embedUrl, allowedHost)) {
    return {
      enabled: false,
      provider,
      embedUrl: undefined,
      dashboardId,
      allowedHost,
    };
  }

  return {
    enabled: true,
    provider,
    embedUrl,
    dashboardId,
    allowedHost,
  };
}

function readEnabled(env: NodeJS.ProcessEnv) {
  return (
    env.BI_NORTH_STAR_ENABLED === "true" ||
    env.POWERBI_NORTH_STAR_ENABLED === "true"
  );
}

function readProvider(env: NodeJS.ProcessEnv): NorthStarBiProvider {
  const value = cleanOptional(env.BI_NORTH_STAR_PROVIDER);
  if (value === "powerbi" || value === "looker" || value === "looker-studio") {
    return value;
  }

  if (env.POWERBI_NORTH_STAR_ENABLED === "true") return "powerbi";

  return value ? "none" : "none";
}

function cleanOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeHost(value: string | undefined) {
  const trimmed = cleanOptional(value);
  return trimmed?.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
}

function isAllowedEmbedUrl(
  provider: NorthStarBiProvider,
  value: string,
  allowedHost: string | undefined,
) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;

    const host = parsed.hostname.toLowerCase();

    if (provider === "powerbi") {
      return host === "powerbi.com" || host.endsWith(".powerbi.com");
    }

    if (provider === "looker-studio") {
      return host === "lookerstudio.google.com" || host === "datastudio.google.com";
    }

    if (provider === "looker") {
      return Boolean(allowedHost) && host === allowedHost;
    }

    return false;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Verify generic config tests pass**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/server/north-star-bi-config.test.ts
```

Expected: all generic config tests pass.

---

## Phase 2: Rename Embed Panel To Provider-Neutral BI

**Purpose:** Replace Power BI-specific UI with provider-aware copy and iframe metadata.

**Files:**
- Create: `apicenter-management/src/components/bi-embed-panel.tsx`
- Create: `apicenter-management/src/components/bi-embed-panel.test.tsx`
- Delete: `apicenter-management/src/components/powerbi-embed-panel.tsx`
- Delete: `apicenter-management/src/components/powerbi-embed-panel.test.tsx`

- [ ] **Step 1: Write failing panel tests**

Create `src/components/bi-embed-panel.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BiEmbedPanel } from "./bi-embed-panel";

describe("BiEmbedPanel", () => {
  afterEach(() => cleanup());

  it("shows a provider-neutral empty state when no dashboard is configured", () => {
    render(<BiEmbedPanel config={{ enabled: false, provider: "none" }} />);

    expect(screen.getByText("BI dashboard not configured")).toBeTruthy();
    expect(screen.queryByTitle("APICenter north-star BI dashboard")).toBeNull();
  });

  it("renders a Looker Studio iframe with provider label", () => {
    render(
      <BiEmbedPanel
        config={{
          enabled: true,
          provider: "looker-studio",
          embedUrl:
            "https://lookerstudio.google.com/embed/reporting/report-id/page/page-id",
          dashboardId: "studio-report",
        }}
      />,
    );

    expect(screen.getByText("Looker Studio")).toBeTruthy();
    const frame = screen.getByTitle("APICenter north-star BI dashboard");
    expect(frame.getAttribute("src")).toBe(
      "https://lookerstudio.google.com/embed/reporting/report-id/page/page-id",
    );
  });

  it("renders a Looker iframe with provider label", () => {
    render(
      <BiEmbedPanel
        config={{
          enabled: true,
          provider: "looker",
          embedUrl: "https://analytics.example.com/embed/dashboards/42",
          dashboardId: "42",
          allowedHost: "analytics.example.com",
        }}
      />,
    );

    expect(screen.getByText("Looker")).toBeTruthy();
    expect(screen.getByText("Dashboard id: 42")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run failing panel tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/bi-embed-panel.test.tsx
```

Expected: fail because `bi-embed-panel.tsx` does not exist.

- [ ] **Step 3: Implement provider-neutral panel**

Create `src/components/bi-embed-panel.tsx`:

```tsx
"use client";

import { BarChart3Icon, ExternalLinkIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  NorthStarBiConfig,
  NorthStarBiProvider,
} from "@/lib/server/north-star-bi-config";

export function BiEmbedPanel({ config }: { config: NorthStarBiConfig }) {
  const providerLabel = getProviderLabel(config.provider);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>BI north-star dashboard</CardTitle>
            <CardDescription>
              Governed BI view over Gold or materialized platform outputs.
            </CardDescription>
          </div>
          {config.provider !== "none" ? <Badge variant="outline">{providerLabel}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent>
        {!config.enabled || !config.embedUrl ? (
          <Alert>
            <BarChart3Icon data-icon="inline-start" />
            <AlertTitle>BI dashboard not configured</AlertTitle>
            <AlertDescription>
              Set BI_NORTH_STAR_ENABLED=true, BI_NORTH_STAR_PROVIDER, and
              BI_NORTH_STAR_EMBED_URL after the dashboard points to governed Gold
              or materialized outputs.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-lg border bg-muted">
              <iframe
                title="APICenter north-star BI dashboard"
                src={config.embedUrl}
                className="h-[720px] w-full bg-background"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allow="fullscreen"
              />
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ExternalLinkIcon className="size-3" />
              Dashboard id: {config.dashboardId ?? "not recorded in environment"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function getProviderLabel(provider: NorthStarBiProvider) {
  if (provider === "powerbi") return "Power BI";
  if (provider === "looker") return "Looker";
  if (provider === "looker-studio") return "Looker Studio";
  return "BI";
}
```

- [ ] **Step 4: Verify panel tests pass**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/bi-embed-panel.test.tsx
```

Expected: all provider-neutral panel tests pass.

- [ ] **Step 5: Remove Power BI-specific panel files**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
Remove-Item -LiteralPath src/components/powerbi-embed-panel.tsx
Remove-Item -LiteralPath src/components/powerbi-embed-panel.test.tsx
```

Expected: files removed after replacements are green.

---

## Phase 3: Wire Generic BI Config Into Data Pipeline

**Purpose:** Move `/data-pipeline` from `powerBiConfig` to `biConfig`.

**Files:**
- Modify: `apicenter-management/src/app/data-pipeline/page.tsx`
- Modify: `apicenter-management/src/components/data-pipeline-dashboard-client.tsx`
- Modify: `apicenter-management/src/components/data-pipeline-dashboard-client.test.tsx`
- Modify: `apicenter-management/src/lib/data-pipeline/north-star-summary.ts`
- Modify: `apicenter-management/src/lib/data-pipeline/north-star-summary.test.ts`

- [ ] **Step 1: Update summary tests for generic BI**

In `src/lib/data-pipeline/north-star-summary.test.ts`, replace:

```ts
expect(summary.metrics.powerBiConfigured).toBe(true);
```

with:

```ts
expect(summary.metrics.biConfigured).toBe(true);
```

Also update test input property names from `powerBiEnabled` to `biEnabled`.

- [ ] **Step 2: Update summary implementation**

In `src/lib/data-pipeline/north-star-summary.ts`:

```ts
// Rename input property
biEnabled: boolean;

// Rename metric
biConfigured: boolean;

// Update visualization answer
answer: input.biEnabled
  ? "The governed BI dashboard is configured for this management environment."
  : "BI dashboard embed is not configured in this management environment.",
status: input.biEnabled ? "complete" : "missing",
evidenceCount: input.biEnabled ? 1 : 0,
```

- [ ] **Step 3: Update dashboard test**

In `src/components/data-pipeline-dashboard-client.test.tsx`, replace the prop:

```tsx
<DataPipelineDashboardClient
  biConfig={{
    enabled: false,
    provider: "none",
  }}
/>
```

Expected test assertions remain:

```ts
expect(screen.getByRole("tab", { name: "BI" })).toBeTruthy();
```

- [ ] **Step 4: Update page and dashboard imports**

In `src/app/data-pipeline/page.tsx`:

```ts
import { getNorthStarBiConfig } from "@/lib/server/north-star-bi-config";

const biConfig = getNorthStarBiConfig();

<DataPipelineDashboardClient biConfig={biConfig} />
```

In `src/components/data-pipeline-dashboard-client.tsx`:

```ts
import type { NorthStarBiConfig } from "@/lib/server/north-star-bi-config";
import { BiEmbedPanel } from "@/components/bi-embed-panel";

export function DataPipelineDashboardClient({
  biConfig,
}: {
  biConfig: NorthStarBiConfig;
}) {
  // ...
  buildNorthStarSummary({
    // ...
    biEnabled: biConfig.enabled,
  });
  // ...
  <BiEmbedPanel config={biConfig} />
}
```

- [ ] **Step 5: Verify generic wiring tests pass**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/server/north-star-bi-config.test.ts src/lib/data-pipeline/north-star-summary.test.ts src/components/bi-embed-panel.test.tsx src/components/data-pipeline-dashboard-client.test.tsx
```

Expected: all generic BI tests pass.

- [ ] **Step 6: Remove old Power BI config files**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
Remove-Item -LiteralPath src/lib/server/north-star-powerbi-config.ts
Remove-Item -LiteralPath src/lib/server/north-star-powerbi-config.test.ts
```

Expected: no remaining imports reference `north-star-powerbi-config`.

- [ ] **Step 7: Confirm no stale Power BI-specific imports**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
rg -n "PowerBi|powerBi|north-star-powerbi|powerbi-embed-panel"
```

Expected: no source imports or component names remain. Documentation may still mention Power BI as one provider.

---

## Phase 4: Environment Template And Docs

**Purpose:** Document provider-neutral BI config while keeping Power BI fallback discoverable for existing deployments.

**Files:**
- Modify: `apicenter-management/.env.example`
- Modify: `apicenter-management/docs/superpowers/plans/2026-05-22-north-star-powerbi-analytics.md`
- Optional if `api-center` branch state is safe to push: `api-center/docs/data-pipeline/platform-team-north-star-bi-plan.md`
- Optional if `api-center` branch state is safe to push: `api-center/docs/data-pipeline/bi-handoff-runbook.md`

- [ ] **Step 1: Replace env template section**

Replace the Power BI section in `.env.example` with:

```dotenv
# ---------------------------------------------------------------------------
# Optional north-star BI embed
# ---------------------------------------------------------------------------
#
# The management console embeds BI only as a governed presentation layer.
# The dashboard must read Gold or materialized outputs, not Raw S3.
#
# Supported providers:
# - powerbi
# - looker
# - looker-studio
BI_NORTH_STAR_ENABLED=false
BI_NORTH_STAR_PROVIDER=looker-studio
BI_NORTH_STAR_DASHBOARD_ID=
BI_NORTH_STAR_EMBED_URL=

# Required for BI_NORTH_STAR_PROVIDER=looker. Use the exact Looker instance
# hostname, for example analytics.example.com.
BI_NORTH_STAR_ALLOWED_HOST=

# Legacy fallback. Existing deployments can keep these temporarily, but new
# deployments should use BI_NORTH_STAR_*.
POWERBI_NORTH_STAR_ENABLED=false
POWERBI_NORTH_STAR_REPORT_ID=
POWERBI_NORTH_STAR_EMBED_URL=
```

- [ ] **Step 2: Update management plan docs**

Update `docs/superpowers/plans/2026-05-22-north-star-powerbi-analytics.md` with a short follow-up note:

```markdown
## Follow-Up: Provider-Neutral BI

The next implementation replaces the Power BI-specific embed with a generic BI
embed that supports Power BI, Looker, and Looker Studio through
`BI_NORTH_STAR_*` environment variables. Existing `POWERBI_NORTH_STAR_*`
variables remain a fallback during migration.
```

- [ ] **Step 3: Update API Center BI docs only if safe**

If `C:\Codes\apic\api-center` has a clean/pushable branch, update the docs to say:

```markdown
The management console can embed an approved Power BI, Looker, or Looker Studio
north-star dashboard. Regardless of provider, the dashboard must read governed
Gold or `materialized_platform.*` outputs and must not connect to Raw S3.
```

Do not modify or push `api-center` during this plan if local `main` is still ahead of remote by unrelated commits.

---

## Phase 5: Verification

**Purpose:** Prove the provider-neutral refactor did not break the data-pipeline dashboard.

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/server/north-star-bi-config.test.ts src/lib/data-pipeline/north-star-summary.test.ts src/components/bi-embed-panel.test.tsx src/components/data-pipeline-dashboard-client.test.tsx src/components/data-pipeline-health-panel.test.tsx src/components/data-pipeline-governance-panel.test.tsx src/components/data-pipeline-cost-panel.test.tsx
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

Expected: Next build succeeds and includes `/data-pipeline`.

- [ ] **Step 4: Run local route smoke**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run dev -- -p 3003
```

Open:

```text
http://localhost:3003/data-pipeline
```

Expected:

- BI tab still appears.
- Empty state says `BI dashboard not configured` when disabled.
- With `BI_NORTH_STAR_PROVIDER=looker-studio` and a valid Looker Studio embed URL, iframe renders.
- With `BI_NORTH_STAR_PROVIDER=looker` and a matching `BI_NORTH_STAR_ALLOWED_HOST`, iframe renders.
- With a mismatched host, iframe does not render.

---

## Phase 6: Commit And Push

**Purpose:** Preserve the provider-neutral BI embed refactor on a branch and merge after verification.

**Files:**
- All modified management files.

- [ ] **Step 1: Commit implementation**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
git status --short
git add .env.example docs/superpowers/plans/2026-05-22-provider-neutral-bi-embed.md docs/superpowers/plans/2026-05-22-north-star-powerbi-analytics.md src/app/data-pipeline/page.tsx src/components/data-pipeline-dashboard-client.tsx src/components/data-pipeline-dashboard-client.test.tsx src/components/bi-embed-panel.tsx src/components/bi-embed-panel.test.tsx src/lib/data-pipeline/north-star-summary.ts src/lib/data-pipeline/north-star-summary.test.ts src/lib/server/north-star-bi-config.ts src/lib/server/north-star-bi-config.test.ts
git add -u src/components/powerbi-embed-panel.tsx src/components/powerbi-embed-panel.test.tsx src/lib/server/north-star-powerbi-config.ts src/lib/server/north-star-powerbi-config.test.ts
git commit -m "feat: support provider-neutral BI embeds"
```

Expected: commit succeeds.

- [ ] **Step 2: Push feature branch**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
git push -u origin provider-neutral-bi-embed
```

Expected: branch is pushed.

- [ ] **Step 3: Merge to main after approval**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
git switch main
git pull --ff-only origin main
git merge --no-ff provider-neutral-bi-embed -m "merge: provider-neutral BI embed"
npm test -- src/lib/server/north-star-bi-config.test.ts src/lib/data-pipeline/north-star-summary.test.ts src/components/bi-embed-panel.test.tsx src/components/data-pipeline-dashboard-client.test.tsx src/components/data-pipeline-health-panel.test.tsx src/components/data-pipeline-governance-panel.test.tsx src/components/data-pipeline-cost-panel.test.tsx
npm run typecheck
npm run build
git push origin main
```

Expected: merged and pushed only after verification passes.

---

## Acceptance Criteria

- `/data-pipeline` no longer depends on Power BI-specific component/config names.
- `BI_NORTH_STAR_PROVIDER=powerbi` supports current Power BI secure embed behavior.
- `BI_NORTH_STAR_PROVIDER=looker-studio` allows only Looker Studio/legacy Data Studio HTTPS embed hosts.
- `BI_NORTH_STAR_PROVIDER=looker` requires an explicit `BI_NORTH_STAR_ALLOWED_HOST`.
- Existing `POWERBI_NORTH_STAR_*` env vars still work as a fallback.
- The BI tab keeps the same native APICenter summary and detailed evidence surfaces.
- Docs make clear that Power BI, Looker, and Looker Studio must read governed Gold/materialized outputs, not Raw S3.
- Focused tests, typecheck, and production build pass.

## Out Of Scope

- Creating a Looker or Looker Studio dashboard.
- Creating LookML models or Looker semantic-layer definitions.
- Implementing signed embed URLs or single-sign-on embed sessions.
- Wiring a Google service account or OAuth flow.
- Changing APICenter backend, Athena SQL, or Gold materialization logic.
