# Management UX Flow Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make API Center Management easier to operate by grouping navigation by task, reducing duplicated UI patterns, and turning tribe onboarding, observability, and lifecycle actions into clear guided flows.

**Architecture:** Keep API Center as the source of truth and keep the app local/private. This plan only reorganizes the Next.js management UI and local docs; it does not add auth, a database, or new external provider behavior.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, TanStack Query, shadcn/ui, lucide-react, existing `/api/local/*` route handlers.

**Implementation status, 2026-05-14:** Implemented. Navigation is grouped, page headings are standardized, shared time-window/state components are in use, service detail is task-sectioned, tribe onboarding has a guided flow, alerts deep-link into service/audit/usage/readiness/settings surfaces, shared-service catalog shows registry state, smoke tests gate provider-impacting checks behind disclosure, manifest tools include copy/download/clear and dry-run guarded import, and docs were updated. Verification: `npm run lint` passed and `npx tsc --noEmit` passed. `npm run build` was attempted but blocked by a Windows `.next` file lock (`EPERM` unlinking `.next/app-path-routes-manifest.json`), likely from an existing dev/build process.

---

## Current Snapshot

Read first:

- `C:\Codes\apic\apicenter-management\docs\operations\ux-flow-snapshot.md`
- `C:\Codes\apic\apicenter-management\DESIGN.md`
- `C:\Codes\apic\apicenter-management\docs\operations\apicenter-management-runbook.md`

Current main issues:

- Service detail pages are long and combine onboarding, observability, developer tooling, and destructive lifecycle actions in one scroll.
- Onboarding steps exist but are split across readiness, registry, service detail, smoke tests, shared usage, audit, and alerts.
- Alerts, cost, audit, shared usage, and per-service observability are separate views with weak cross-linking.
- `usageWindows` and the time-window selector are duplicated across multiple components.
- Empty/error/setup-required states are inconsistent.
- The sidebar is complete but flat, so users have to know which page maps to which task.

## File Map

- Modify: `src/components/app-shell.tsx`
  - Group sidebar navigation by operator intent.
  - Keep mobile sheet behavior.
- Create: `src/components/page-heading.tsx`
  - Shared compact page title, description, and action slot.
- Modify: all route `page.tsx` files under `src/app/*`
  - Replace hand-written title blocks with `PageHeading`.
- Create: `src/components/time-window-selector.tsx`
  - Shared 1h/24h/7d/30d segmented control.
- Create: `src/lib/usage-windows.ts`
  - Shared `usageWindows` constant and `SharedServiceUsageWindow` type re-export.
- Modify:
  - `src/components/alerts-client.tsx`
  - `src/components/cost-insights-client.tsx`
  - `src/components/shared-service-usage-matrix.tsx`
  - `src/components/tribe-observability-panel.tsx`
  - `src/components/shared-service-observability-panel.tsx`
  - Use `TimeWindowSelector`.
- Create: `src/components/query-state.tsx`
  - `SetupRequiredState`, `EmptyDataState`, and `ActionFailedState`.
- Modify affected client components to use the shared state components.
- Modify: `src/components/service-detail-client.tsx`
  - Add task sections/tabs for Overview, Onboarding, Observability, Lifecycle, and Developer tools.
- Create: `src/components/tribe-onboarding-flow.tsx`
  - Guide secret, Confluent, token, smoke, usage/audit checks in order.
- Modify: `src/components/shared-service-smoke-tests.tsx`
  - Compact safe checks and move provider-impacting checks into a clearer gated section.
- Modify: `src/app/shared-services/page.tsx`
  - Show registration state and setup action in the catalog.
- Modify: `src/components/alerts-client.tsx`
  - Make alerts the main triage entry point with links to service detail, audit, usage, and smoke checks.
- Modify docs:
  - `README.md`
  - `docs/operations/apicenter-management-runbook.md`
  - `docs/operations/ux-flow-snapshot.md`

---

## Phase 1: Navigation And Page Structure

**Outcome:** Users can understand the console from the sidebar and every page has a consistent title/action area.

- [ ] **Step 1: Group sidebar navigation**

Modify `src/components/app-shell.tsx`.

Replace the flat `navItems` array with grouped navigation:

```ts
const navGroups = [
  {
    label: "Operate",
    items: [
      { href: "/", label: "Dashboard", icon: HomeIcon },
      { href: "/alerts", label: "Alerts", icon: BellIcon },
      { href: "/audit", label: "Audit", icon: ListChecksIcon },
      { href: "/cost", label: "Cost signals", icon: BarChart3Icon },
    ],
  },
  {
    label: "Registry",
    items: [
      { href: "/tribes", label: "Services", icon: NetworkIcon },
      { href: "/dependencies", label: "Dependencies", icon: NetworkIcon },
      { href: "/manifest-tools", label: "Manifest tools", icon: FileJsonIcon },
    ],
  },
  {
    label: "Shared services",
    items: [
      { href: "/shared-services", label: "Catalog", icon: ActivityIcon },
      { href: "/shared-services/usage", label: "Usage matrix", icon: BarChart3Icon },
      { href: "/smoke-tests", label: "Smoke tests", icon: FlaskConicalIcon },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/readiness", label: "Readiness", icon: CheckCircleIcon },
      { href: "/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];
```

Render group labels as small, readable text. Do not use decorative badges.

- [ ] **Step 2: Keep active state working for nested routes**

Update `isNavActive()` so:

```ts
if (href === "/tribes") {
  return pathname === "/tribes" || pathname.startsWith("/tribes/");
}
if (href === "/shared-services") {
  return pathname === "/shared-services" || pathname === "/shared-services/setup";
}
return pathname === href || pathname.startsWith(`${href}/`);
```

- [ ] **Step 3: Create shared page heading**

Create `src/components/page-heading.tsx`:

```tsx
import type { ReactNode } from "react";

export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Replace route heading blocks**

Modify each route page that has a repeated `<h1>` and paragraph:

- `src/app/readiness/page.tsx`
- `src/app/tribes/page.tsx`
- `src/app/tribes/new/page.tsx`
- `src/app/dependencies/page.tsx`
- `src/app/shared-services/usage/page.tsx`
- `src/app/smoke-tests/page.tsx`
- `src/app/audit/page.tsx`
- `src/app/alerts/page.tsx`
- `src/app/cost/page.tsx`
- `src/app/manifest-tools/page.tsx`
- `src/app/settings/page.tsx`

Use `PageHeading` with the current title and description text.

- [ ] **Step 5: Verify**

Run:

```powershell
npm run lint
npx tsc --noEmit
```

Expected: both pass.

---

## Phase 2: Reusable Operator Controls And States

**Outcome:** Time windows, empty states, setup-required states, and query failures behave consistently.

- [ ] **Step 1: Create shared usage window constant**

Create `src/lib/usage-windows.ts`:

```ts
import type { SharedServiceUsageWindow } from "@/lib/schemas";

export const usageWindows: SharedServiceUsageWindow[] = ["1h", "24h", "7d", "30d"];
```

- [ ] **Step 2: Create shared time-window selector**

Create `src/components/time-window-selector.tsx`:

```tsx
"use client";

import type { SharedServiceUsageWindow } from "@/lib/schemas";
import { usageWindows } from "@/lib/usage-windows";
import { cn } from "@/lib/utils";

export function TimeWindowSelector({
  value,
  onChange,
  ariaLabel = "Select time window",
}: {
  value: SharedServiceUsageWindow;
  onChange: (value: SharedServiceUsageWindow) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="flex rounded-full border bg-background p-1" aria-label={ariaLabel}>
      {usageWindows.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={cn(
            "h-8 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors",
            value === option && "bg-primary text-primary-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Replace duplicated time-window controls**

Modify:

- `src/components/alerts-client.tsx`
- `src/components/cost-insights-client.tsx`
- `src/components/shared-service-usage-matrix.tsx`
- `src/components/tribe-observability-panel.tsx`
- `src/components/shared-service-observability-panel.tsx`

Remove local `usageWindows` constants and the repeated button map. Use:

```tsx
<TimeWindowSelector value={window} onChange={setWindow} />
```

- [ ] **Step 4: Create query-state components**

Create `src/components/query-state.tsx`:

```tsx
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function SetupRequiredState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Alert>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}

export function EmptyDataState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Alert>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}

export function ActionFailedState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 5: Replace the highest-traffic states first**

Modify:

- `src/components/readiness-client.tsx`
- `src/components/tribe-list-client.tsx`
- `src/components/shared-service-usage-matrix.tsx`
- `src/components/shared-service-smoke-tests.tsx`
- `src/components/cost-insights-client.tsx`
- `src/components/alerts-client.tsx`

Use:

- `ActionFailedState` for actual failed writes or blocked fetches.
- `SetupRequiredState` for analytics endpoints that are not deployed yet.
- `EmptyDataState` for valid but empty data.

- [ ] **Step 6: Verify**

Run:

```powershell
npm run lint
npx tsc --noEmit
npm run build
```

Expected: all pass.

---

## Phase 3: Service Detail Task Sections

**Outcome:** A service detail page becomes task-oriented instead of one long operational stack.

- [ ] **Step 1: Add a local tab state to service detail**

Modify `src/components/service-detail-client.tsx`.

Add:

```tsx
const [section, setSection] = useState<
  "overview" | "onboarding" | "observability" | "lifecycle" | "developer"
>("overview");
```

Use existing `Tabs`, `TabsList`, `TabsTrigger`, and `TabsContent` components.

- [ ] **Step 2: Move existing panels into sections**

Keep all existing components, but group them:

- Overview:
  - service summary card
  - dependencies card
  - onboarding checklist
- Onboarding:
  - `TribeSecretProvisionCard`
  - `ConfluentProvisioningCard`
  - shortcut to `/smoke-tests?tribeId=<serviceId>`
  - `SdkConfigPanel`
- Observability:
  - `TribeObservabilityPanel` or `SharedServiceObservabilityPanel`
  - `EventMappingPanel`
- Lifecycle:
  - `TribeDeprovisioningCard`
  - registry lifecycle actions card
- Developer:
  - `ContractTesterPanel`
  - manifest details or manifest export link

- [ ] **Step 3: Preserve shared-service behavior**

For shared services, hide tribe-only onboarding/deprovisioning and show:

- overview
- observability
- developer
- lifecycle

- [ ] **Step 4: Add URL section support**

Read an optional `?section=` search param on service detail pages and use it to
set the initial tab. This allows links like:

```text
/tribes/servease?section=onboarding
/tribes/servease?section=observability
/tribes/servease?section=lifecycle
```

- [ ] **Step 5: Verify**

Run:

```powershell
npm run lint
npx tsc --noEmit
```

Open:

```text
http://localhost:3000/tribes/servease
```

Expected:

- Overview is the first visible section.
- Tribe onboarding actions are under Onboarding.
- Destructive actions are under Lifecycle.
- Existing buttons still work.

---

## Phase 4: Guided Tribe Onboarding

**Outcome:** A new tribe has a clear path from registered manifest to tested shared-service usage.

- [ ] **Step 1: Create onboarding flow component**

Create `src/components/tribe-onboarding-flow.tsx`.

It should accept:

```ts
{
  serviceId: string;
  consumes: string[];
  healthCheck?: string;
}
```

Render ordered checklist rows:

1. Manifest registered
2. Owner/contact set
3. Health path set
4. Tribe secret provisioned
5. Confluent topic created
6. Topic added to S3 sink
7. Token requested
8. Safe smoke checks run
9. Runtime usage/audit checked

- [ ] **Step 2: Use available status data**

Use existing query/client functions where available:

- service manifest data from service detail props
- `getTribeSecretStatus(serviceId)`
- topic/S3 sink status only if existing API functions support it; otherwise show action buttons and a "not checked in this UI yet" state

Do not add destructive cloud actions in this phase.

- [ ] **Step 3: Link each step to the right UI**

Examples:

```tsx
<Link href={`/tribes/${serviceId}?section=onboarding`}>Open onboarding</Link>
<Link href={`/smoke-tests?tribeId=${serviceId}`}>Request token and run smoke tests</Link>
<Link href="/shared-services/usage">Check usage matrix</Link>
<Link href={`/audit?serviceId=${serviceId}`}>Check audit events</Link>
```

- [ ] **Step 4: Replace or reduce duplicated checklist text**

Keep `OnboardingChecklistPanel` if it remains useful for quick metadata checks,
but avoid showing two different lists that claim to be the main onboarding flow.

- [ ] **Step 5: Verify**

Open:

```text
http://localhost:3000/tribes/servease?section=onboarding
```

Expected:

- The operator can see the next incomplete step.
- Links move them to the correct action.
- No plaintext secret is persisted.

---

## Phase 5: Alerts As Triage Entry Point

**Outcome:** Operators can start from alerts and land on the exact page/action needed to fix an issue.

- [ ] **Step 1: Add alert action links**

Modify `src/components/alerts-client.tsx`.

For each alert row:

- If `serviceId` exists, link to `/tribes/<serviceId>?section=overview`.
- Add "Audit" link to `/audit?serviceId=<serviceId>`.
- If alert type is shared-service usage or high error rate, add "Usage" link to `/shared-services/usage`.
- If alert type is readiness or Kafka publish, add "Settings" or "Readiness" link.

- [ ] **Step 2: Add audit query-param defaults**

Modify `src/app/audit/page.tsx` and `src/components/audit-log-client.tsx` so:

```text
/audit?serviceId=servease&type=service.registered
```

pre-fills the filter inputs.

- [ ] **Step 3: Add dashboard alert handoff**

Modify `src/components/dashboard-alert-strip.tsx` so each visible alert can open
the relevant detail or alerts page.

- [ ] **Step 4: Verify**

Open:

```text
http://localhost:3000/alerts
```

Expected:

- Alert rows have direct next-action links.
- Audit links pre-fill filters.
- Empty alert state remains quiet and non-alarming.

---

## Phase 6: Shared-Service Catalog And Smoke-Test Polish

**Outcome:** Shared-service setup and smoke testing feel like one platform workflow instead of separate utilities.

- [ ] **Step 1: Add registration state to the shared-services catalog**

Modify `src/app/shared-services/page.tsx` into a client component or wrap the
catalog with a client component that calls `listServices`.

Each shared-service card should show:

- registered/unregistered
- owner/team if registered
- health path if registered
- required secret signal
- action: register/update manifest or open detail

- [ ] **Step 2: De-emphasize separate setup page**

Keep `/shared-services/setup` for batch registration, but make `/shared-services`
the default place operators start.

- [ ] **Step 3: Compact safe smoke checks**

Modify `src/components/shared-service-smoke-tests.tsx`.

Create one "Safe checks" card listing:

- gauth health
- gauth authorize URL
- geo health
- geo geofence
- payment health
- email health
- sms health
- otp health

Keep one button for "Run safe checks" and show per-service result rows below.

- [ ] **Step 4: Gate provider-impacting checks in a disclosure**

Move:

- payment checkout
- email send
- sms send
- otp generate

behind a `<details>` section or tabs labelled "Provider-impacting checks".

- [ ] **Step 5: Verify**

Open:

```text
http://localhost:3000/shared-services
http://localhost:3000/smoke-tests
```

Expected:

- Catalog clearly shows what is registered.
- Safe smoke testing is visible first.
- Provider-impacting tests require explicit confirmation.

---

## Phase 7: Manifest Tools And Export Quality

**Outcome:** Operators can move between service detail, edit, and manifest tools without copy/paste friction.

- [ ] **Step 1: Add copy/export buttons to manifest tools**

Modify `src/components/manifest-tools-client.tsx`.

Add:

- Copy registry JSON
- Download registry JSON
- Clear import input

- [ ] **Step 2: Add service-level manifest export**

Modify `src/components/service-detail-client.tsx`.

In Developer section, add a readonly manifest JSON block with:

- Copy manifest
- Open edit page
- Open manifest tools

- [ ] **Step 3: Preserve dry-run safety**

Do not allow import without a successful dry run unless the current behavior is
intentionally retained. Preferred behavior:

```ts
const canImport = Boolean(dryRun) && !importMutation.isPending;
```

- [ ] **Step 4: Verify**

Open:

```text
http://localhost:3000/manifest-tools
http://localhost:3000/tribes/servease?section=developer
```

Expected:

- Copy buttons work.
- Import remains guarded by dry-run validation.

---

## Phase 8: UI Regression Checks And Docs

**Outcome:** The improved flow is documented and protected by basic verification.

- [ ] **Step 1: Add manual QA checklist**

Create `docs/operations/ui-qa-checklist.md` with routes and checks:

- desktop and mobile navigation
- readiness
- register smoke tribe
- service detail sections
- secret provisioning card renders without exposing secrets
- Confluent provisioning card renders
- deprovision card requires typed confirmation
- smoke tests safe flow
- shared usage matrix
- alerts to audit handoff

- [ ] **Step 2: Update runbook flow**

Modify `docs/operations/apicenter-management-runbook.md`.

Update the full new-tribe E2E flow to use the new service-detail sections:

```text
/tribes/<service-id>?section=onboarding
/tribes/<service-id>?section=observability
/tribes/<service-id>?section=lifecycle
```

- [ ] **Step 3: Update README**

Modify `README.md`.

Add links to:

- `docs/operations/ux-flow-snapshot.md`
- `docs/operations/ui-qa-checklist.md`
- this plan

- [ ] **Step 4: Final verification**

Run:

```powershell
npm run lint
npx tsc --noEmit
npm run build
```

Browser-check:

```text
http://localhost:3000/
http://localhost:3000/tribes
http://localhost:3000/tribes/servease?section=onboarding
http://localhost:3000/shared-services
http://localhost:3000/smoke-tests
http://localhost:3000/alerts
```

Expected:

- No framework error overlay.
- Mobile navigation remains reachable.
- Destructive actions remain typed-confirmed.
- Provider-impacting checks remain gated.

---

## Out Of Scope

- Public deployment.
- Admin auth.
- A management database.
- New API Center backend analytics endpoints.
- Deleting Confluent topics.
- Deleting S3 objects.
- Replacing Prometheus/Grafana or cloud monitoring.

## Self-Review

- Spec coverage: plan covers current snapshot, redundancies, operator flow, UX improvements, and docs.
- Placeholder scan: no TBD placeholders are required to execute the plan.
- Risk boundary: the plan reorganizes UI and docs only; cloud and destructive provider behavior stay behind existing guarded actions.
