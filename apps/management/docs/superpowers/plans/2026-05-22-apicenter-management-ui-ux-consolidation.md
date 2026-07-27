# API Center Management UI/UX Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apicenter-management` feel like a focused operations console by reducing long screens, consolidating unclear pages, improving core table/detail UX, and keeping advanced diagnostics available without making them first-class navigation clutter.

**Architecture:** Keep the current Next.js App Router structure and existing `/api/local/*` data contracts. The redesign should reorganize route visibility, page composition, and shared UI primitives before adding new backend behavior. API Center remains the source of truth for registry, analytics, audit, secrets metadata, Confluent, and S3 export state.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, TanStack Query, shadcn/ui primitives, lucide-react, Tailwind CSS variables in `src/app/globals.css`.

---

## Current Findings

The app already has the right capabilities, but the current IA exposes too many implementation utilities as peer pages. The strongest surfaces are `Dashboard`, `Registry`, `Service detail`, `Readiness`, and `Shared services`; the weakest surfaces are the long diagnostic workflows that require operators to know where to go before the UI tells them.

| Surface | Current state | Keep as top-level? | Direction |
| --- | --- | --- | --- |
| `/` Dashboard | Polished but starts with a large hero before the highest-risk work. | Yes | Make it an operations workbench: health, broken deps, missing owners, proposed actions, and recent alerts first. |
| `/tribes` Services | Core registry table is useful but too wide and horizontally scrolls on desktop. | Yes | Rename nav label to `Registry`, add sticky action column, compact metadata, and mobile row cards. |
| `/tribes/[serviceId]` Detail | Five tabs are valid, but `Onboarding`, `Observability`, and `Developer tools` are too long. | Yes, via registry | Convert tabs into task sections with right-side status rail and collapsible advanced panels. |
| `/readiness` Readiness | Useful, but failure cards do not provide enough direct fix actions. | Yes | Keep top-level under setup, add fix-forward actions and copy/run helpers. |
| `/shared-services` Catalog | Best visual page, but duplicated with setup and usage. | Yes | Make it the shared-service home: catalog, setup state, usage summary, and smoke entry. |
| `/shared-services/setup` | Batch setup utility duplicating catalog content. | No direct nav | Keep as secondary action from shared-services home. |
| `/shared-services/usage` | Useful analytics matrix, but too dense as a standalone nav item. | Secondary | Move under shared-services home or Observability group; keep direct route. |
| `/smoke-tests` | Powerful but long and intimidating. | No direct nav | Make it a task launched from shared-service home or service onboarding. |
| `/alerts` | Good triage entry point. | Yes | Promote as `Issues`; it should route operators to exact fix surfaces. |
| `/audit` | Useful evidence log, not a starting point for most operators. | No direct nav | Move under `Advanced` or link from issues/detail pages. |
| `/cost` | Provider usage belongs with observability/data pipeline. | No direct nav | Fold into `Observability` or `Data pipeline`; keep direct route. |
| `/data-pipeline` | Important for S3/export visibility, but currently reads like a separate dashboard. | Yes if active scope | Rename to `Pipeline` and make it topic/S3-oriented, not a generic metrics page. |
| `/dependencies` | Useful but overlaps dashboard broken deps and service detail dependencies. | Secondary | Keep under registry as `Dependencies`; use it for global map only. |
| `/registration-requests` | Approvals are important but not always active. | Conditional | Keep under registry, but show a count badge only if pending requests exist. |
| `/manifest-tools` | Advanced import/export utility. | No direct primary nav | Move to `Advanced` or link from registry/detail developer sections. |
| `/settings` | Necessary, but too mixed: session, endpoint, deployment restart, provider config health. | Yes | Split into `Environment`, `Access`, `Provider config`, and `Danger zone` sections. |

## Navigation Target

Use fewer first-level sidebar items. Keep direct routes for deep links, but make the visible nav reflect operator workflows.

```text
Overview
- Dashboard
- Issues
- Readiness

Registry
- Services
- Dependencies
- Requests

Shared Services
- Catalog
- Pipeline

Advanced
- Audit
- Manifest tools
- Smoke tests
- Cost signals
- Settings
```

Rules:

- `Advanced` can be collapsed by default on desktop and hidden behind a drawer group on mobile.
- Keep `Smoke tests`, `Manifest tools`, `Audit`, and `Cost signals` accessible by URL and cross-links, but stop presenting them as equally important daily destinations.
- Rename UI copy away from implementation terms where possible: `Alerts` becomes `Issues`, `Tribes` becomes `Registry` or `Services`, `Data pipeline` becomes `Pipeline`.
- Do not remove routes in this phase; first reduce navigation prominence and add cross-links.

---

## Phase 1: Information Architecture And Navigation Cleanup

**Outcome:** The console has fewer visible destinations and each visible destination has a clear operator job.

**Files:**

- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/page-heading.tsx`
- Modify: `src/app/*/page.tsx` where page titles need wording changes
- Test: `src/components/app-shell.test.tsx` if added, otherwise route smoke screenshots

- [ ] **Step 1: Rework sidebar groups**

Update `navGroups` in `src/components/app-shell.tsx` to the target navigation above. Keep the existing icons, but remove duplicate mental models:

```ts
const navGroups = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: HomeIcon },
      { href: "/alerts", label: "Issues", icon: BellIcon },
      { href: "/readiness", label: "Readiness", icon: CheckCircleIcon },
    ],
  },
  {
    label: "Registry",
    items: [
      { href: "/tribes", label: "Services", icon: NetworkIcon },
      { href: "/dependencies", label: "Dependencies", icon: NetworkIcon },
      { href: "/registration-requests", label: "Requests", icon: ClipboardCheckIcon },
    ],
  },
  {
    label: "Shared services",
    items: [
      { href: "/shared-services", label: "Catalog", icon: ActivityIcon },
      { href: "/data-pipeline", label: "Pipeline", icon: DatabaseZapIcon },
    ],
  },
  {
    label: "Advanced",
    items: [
      { href: "/audit", label: "Audit", icon: ListChecksIcon },
      { href: "/manifest-tools", label: "Manifest tools", icon: FileJsonIcon },
      { href: "/smoke-tests", label: "Smoke tests", icon: FlaskConicalIcon },
      { href: "/cost", label: "Cost signals", icon: BarChart3Icon },
      { href: "/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];
```

- [ ] **Step 2: Add advanced group affordance**

Make `Advanced` visually quieter than the main groups. Use plain disclosure behavior only if it can be implemented without disrupting keyboard access. If not, keep it expanded but separated lower in the sidebar.

- [ ] **Step 3: Update page titles**

Use clearer operator wording:

- `/alerts`: title `Issues`, description `Fix registry, runtime, and readiness problems from one queue.`
- `/data-pipeline`: title `Pipeline`, description `Check topic publishing, S3 export, gateway decisions, quality, and Athena cost signals.`
- `/tribes`: title `Services`, description `Registered tribe and shared-service manifests.`

- [ ] **Step 4: Verify active states**

Check these paths:

```text
/
/alerts
/readiness
/tribes
/tribes/smoke-tribe
/shared-services
/shared-services/setup
/data-pipeline
/manifest-tools
```

Expected: the sidebar active state follows the parent workflow, not only exact routes.

---

## Phase 2: Visual System Reset

**Outcome:** The app looks less like a decorative dashboard and more like a dense, polished operator workspace.

**Files:**

- Modify: `src/app/globals.css`
- Modify: `src/components/ui/card.tsx`
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/page-heading.tsx`
- Modify: `src/components/environment-banner.tsx`

- [ ] **Step 1: Reduce large-radius and hero defaults**

Keep `12px` for cards and panels, `8px` for controls, and pill radius only for primary buttons/chips. Avoid using the dashboard hero pattern on non-dashboard pages.

- [ ] **Step 2: Tighten page spacing**

Reduce default page vertical rhythm from marketing-like spacing to operator spacing:

```tsx
<div className="flex flex-col gap-4">
```

Use `gap-6` only when a page has distinct major sections.

- [ ] **Step 3: Make environment chrome compact on mobile**

In `EnvironmentBanner` and the app shell status bar, collapse mobile metadata into one compact block:

- environment
- role
- readiness link

The current mobile chrome pushes content too far down before the operator reaches the page body.

- [ ] **Step 4: Standardize page heading scale**

Keep page `h1` at `text-2xl` or `text-3xl`, no negative tracking in compact pages. Long descriptions should be shorter and action-oriented.

- [ ] **Step 5: Verify screenshots**

Capture:

```powershell
msedge --headless --window-size=1440,1000 --screenshot=C:\tmp\apic-ui-dashboard.png http://localhost:3000/
msedge --headless --window-size=390,844 --screenshot=C:\tmp\apic-ui-mobile.png http://localhost:3000/
```

Expected: first viewport is content-dense, mobile content starts sooner, no overlapping text.

---

## Phase 3: Dashboard As Operations Workbench

**Outcome:** The first page tells the operator what needs action before it shows decorative context.

**Files:**

- Modify: `src/components/dashboard-client.tsx`
- Modify: `src/components/dashboard-alert-strip.tsx`
- Modify: `src/components/proposed-actions-panel.tsx`

- [ ] **Step 1: Replace the large hero with compact status header**

Turn the hero into a shorter status band with:

- environment
- total services
- broken dependencies
- missing owners
- active issues
- primary action

Keep the dark green brand treatment, but reduce height and remove the large explanatory headline.

- [ ] **Step 2: Promote proposed actions**

Move proposed actions above generic workflow cards. Show the first three actions and an explicit `View all issues` or `Review all proposed actions` link.

- [ ] **Step 3: Remove duplicate next-action blocks**

The current dashboard has workflow links and a separate `Next actions` card. Keep one action area and remove the duplicate.

- [ ] **Step 4: Make dashboard cards actionable**

Each metric should link to the relevant route:

- missing owners -> `/tribes?filter=missing-owner`
- broken deps -> `/dependencies?status=broken`
- active issues -> `/alerts`
- unhealthy -> `/tribes?status=unhealthy`

If filters are not supported yet, add route links first and implement filters in Phase 4.

---

## Phase 4: Registry Table And Filters

**Outcome:** The registry becomes the strongest daily-use screen: readable, dense, searchable, and usable without horizontal guessing.

**Files:**

- Modify: `src/components/tribe-list-client.tsx`
- Modify: `src/components/registry-filters.tsx`
- Modify: `src/components/ui/table.tsx`
- Modify: `src/components/service-table.tsx`
- Test: `src/components/tribe-list-client.test.tsx`

- [ ] **Step 1: Add real labels to filters**

Replace placeholder-only filters with visible labels or `aria-label` plus compact visual labels:

- Search
- Owner
- Type
- Status

- [ ] **Step 2: Add missing operational filters**

Support:

- missing owner
- missing health path
- broken dependency
- shared service
- tribe service

- [ ] **Step 3: Fix desktop horizontal scroll**

Keep horizontal scroll for very small screens, but on desktop reduce columns:

```text
Service | Owner | Runtime | Event topic | Status | Action
```

Move `Backend URL`, `Updated`, and `Consumes` into second-line row metadata or a row details disclosure.

- [ ] **Step 4: Sticky service and action columns**

Make the service identity column and action column remain visible when the table scrolls. If sticky table columns become brittle, replace table rows with a dense list layout at desktop width.

- [ ] **Step 5: Mobile card layout**

Below `768px`, render services as row cards with:

- service name and ID
- owner/contact
- status
- broken/missing warnings
- `Open` action

Do not stack the full table horizontally on mobile.

---

## Phase 5: Service Detail Tab Consolidation

**Outcome:** Service detail stops feeling like five long pages hidden behind tabs.

**Files:**

- Modify: `src/components/service-detail-client.tsx`
- Modify: `src/components/service-detail/service-identity-panel.tsx`
- Modify: `src/components/service-detail/service-actions-panel.tsx`
- Modify: `src/components/service-detail/service-pipeline-panel.tsx`
- Modify: `src/components/tribe-onboarding-flow.tsx`
- Modify: `src/components/tribe-onboarding-packet-panel.tsx`
- Modify: `src/components/sdk-config-panel.tsx`
- Test: `src/components/service-detail-client.test.tsx`

- [ ] **Step 1: Reduce visible tabs**

Change five tabs into three primary tabs:

```text
Overview | Operate | Developer
```

Map current content:

- `Overview`: identity, status, dependencies, quick warnings, recent timeline.
- `Operate`: onboarding, secret, Confluent/S3, smoke link, lifecycle/deprovisioning.
- `Developer`: SDK config, onboarding packet, contract tester, manifest export.

Keep `?section=onboarding`, `?section=observability`, and `?section=lifecycle` as backwards-compatible aliases that open `Operate` and scroll to the right anchor.

- [ ] **Step 2: Add right-side status rail on desktop**

For service detail, add a compact rail with:

- lifecycle status
- owner/contact
- secret health
- topic/S3 state
- latest audit timestamp
- primary next action

This rail prevents users from scrolling through long sections just to understand what is wrong.

- [ ] **Step 3: Collapse advanced panels**

Inside `Operate`, use disclosures for:

- Secret operation preview
- Provider-impacting smoke checks
- Deprovisioning
- Raw pipeline rows

Keep destructive actions visible only after the user opens the relevant operation area.

- [ ] **Step 4: Split `service-detail-client.tsx`**

It is over 800 lines. Split by responsibility:

- `src/components/service-detail/service-detail-client.tsx`
- `src/components/service-detail/service-detail-tabs.tsx`
- `src/components/service-detail/service-detail-status-rail.tsx`
- `src/components/service-detail/manifest-export-panel.tsx`
- `src/components/service-detail/tribe-secret-provision-card.tsx`

Preserve existing behavior while moving code.

- [ ] **Step 5: Test alias behavior**

Check:

```text
/tribes/smoke-tribe
/tribes/smoke-tribe?section=onboarding
/tribes/smoke-tribe?section=observability
/tribes/smoke-tribe?section=lifecycle
/tribes/gauth
```

Expected: links still land on useful content and shared services do not show tribe-only workflows.

---

## Phase 6: Shared Services And Smoke Tests

**Outcome:** Shared-service work starts from one clear home, while smoke tests become a secondary task instead of a long standalone tool.

**Files:**

- Modify: `src/components/shared-services-catalog-client.tsx`
- Modify: `src/components/shared-services-setup-client.tsx`
- Modify: `src/components/shared-service-smoke-tests.tsx`
- Modify: `src/components/smoke-token-card.tsx`
- Test: `src/components/shared-service-smoke-tests.test.tsx`

- [ ] **Step 1: Make `/shared-services` the hub**

Add compact top summaries:

- registered shared services
- missing provider config
- recent runtime failures
- safe smoke status

- [ ] **Step 2: Combine catalog and setup language**

Each shared-service card should answer:

- is it registered
- which secret signal is required
- is provider config healthy
- what route tribes call
- what action is next

Link to `/shared-services/setup` only for batch setup.

- [ ] **Step 3: Rebuild smoke tests as a two-step flow**

Step 1: token and tribe identity.

Step 2: checks grouped by service.

Use two sections:

- Safe checks
- Provider-impacting checks

Provider-impacting checks stay behind explicit confirmation.

- [ ] **Step 4: Split `shared-service-smoke-tests.tsx`**

It is over 700 lines. Split into:

- `src/components/smoke-tests/smoke-test-presets.ts`
- `src/components/smoke-tests/smoke-test-runner.tsx`
- `src/components/smoke-tests/smoke-test-result-list.tsx`
- `src/components/smoke-tests/provider-impacting-checks.tsx`

---

## Phase 7: Observability Consolidation

**Outcome:** Issues, audit, cost, usage, and pipeline data feel connected instead of scattered.

**Files:**

- Modify: `src/components/alerts-client.tsx`
- Modify: `src/components/audit-log-client.tsx`
- Modify: `src/components/cost-insights-client.tsx`
- Modify: `src/components/data-pipeline-dashboard-client.tsx`
- Modify: `src/components/shared-service-usage-matrix.tsx`
- Modify: `src/components/service-timeline-panel.tsx`

- [ ] **Step 1: Rename alerts UI to issues**

Keep route `/alerts`, but present the page as `Issues`.

- [ ] **Step 2: Add issue-to-fix routing**

Every issue row should expose one primary action:

- broken dependency -> service detail or dependencies
- readiness failure -> readiness
- shared-service runtime failure -> shared-services usage
- provider/cost issue -> cost detail
- pipeline issue -> pipeline

- [ ] **Step 3: Move cost into pipeline context**

Keep `/cost`, but link it from `/data-pipeline` and shared-service usage. In navigation, keep it under `Advanced` unless provider spend becomes a daily operating concern.

- [ ] **Step 4: Audit as evidence, not primary navigation**

Audit should be linked from:

- issue rows
- service detail status rail
- lifecycle actions
- registration approvals

Use query params to prefill service/action filters.

---

## Phase 8: Settings And Advanced Tools

**Outcome:** Dangerous or rarely used utilities are findable but not visually equal to daily workflows.

**Files:**

- Modify: `src/app/settings/page.tsx`
- Modify: `src/components/deployment-restart-card.tsx`
- Modify: `src/components/management-session-card.tsx`
- Modify: `src/components/secret-health-panel.tsx`
- Modify: `src/components/manifest-tools-client.tsx`

- [ ] **Step 1: Split settings sections**

Use section headings:

- Environment
- Access/session
- Provider config health
- Deployment actions
- Secret policy

- [ ] **Step 2: Move deployment restart to danger zone**

`DeploymentRestartCard` should be visually separated and clearly disabled unless enabled.

- [ ] **Step 3: Make manifest tools explicitly advanced**

Add copy that says it is for bulk import/export and recovery. Link users back to registry and service detail for normal edits.

- [ ] **Step 4: Add breadcrumbs or back-links**

Advanced routes should offer `Back to Services`, `Back to Shared services`, or `Back to Issues` depending on context.

---

## Phase 9: Accessibility And Responsive QA

**Outcome:** The redesigned console is keyboard reachable, readable, and stable on mobile.

**Files:**

- Modify: `docs/operations/ui-qa-checklist.md`
- Modify: components touched in prior phases
- Optional create: `scripts/capture-ui-screenshots.mjs`

- [ ] **Step 1: Add accessibility acceptance checks**

Update `docs/operations/ui-qa-checklist.md` with:

- keyboard tab order for sidebar, tabs, tables, and dialogs
- visible focus states
- labeled filters/selects
- no color-only status
- no mobile text overlap
- no hidden actions behind horizontal scroll

- [ ] **Step 2: Add screenshot matrix**

Capture:

```text
/
/alerts
/readiness
/tribes
/tribes/smoke-tribe
/shared-services
/data-pipeline
/settings
```

Widths:

```text
390x844
768x1024
1440x1000
```

- [ ] **Step 3: Run verification**

Run:

```powershell
npm run lint
npm run typecheck
npm test -- src/components/tribe-list-client.test.tsx src/components/service-detail-client.test.tsx src/components/shared-service-smoke-tests.test.tsx
npm run build
```

Expected: all pass. If build fails from `.next` file locks, stop the running Next dev process and rerun.

---

## Design Guardrails

- Use the existing API Center brand mark and mint accent.
- Keep operational pages dense and calm.
- Do not add marketing copy, decorative hero sections, glass panels, glows, or fake charts.
- Do not remove routes until cross-links and docs prove operators no longer need direct nav access.
- Do not expose platform, provider, Confluent, Redis, Descope, or tribe plaintext secrets in browser data.
- Keep destructive/provider-impacting actions behind preview, typed confirmation, reason, or explicit enablement.

## Execution Order

1. IA/navigation cleanup.
2. Visual system reset.
3. Dashboard and registry improvements.
4. Service detail tab consolidation.
5. Shared-service and smoke-test cleanup.
6. Observability consolidation.
7. Settings/advanced cleanup.
8. Responsive and accessibility QA.

This order improves the app’s perceived quality early without breaking privileged workflows.

## Out Of Scope

- New auth provider work.
- New management database.
- Deleting cloud resources.
- Replacing API Center analytics endpoints.
- Removing existing routes.
- Rebranding the logo or changing the product identity.

## Self-Review

- The plan covers every visible sidebar route and both tabbed surfaces.
- The plan identifies which pages should remain top-level, move to advanced navigation, or become contextual links.
- The plan addresses long screens by consolidating service detail tabs and splitting oversized components.
- The plan keeps current backend contracts intact and does not add unsafe provider behavior.
- The plan includes mobile, keyboard, and accessibility verification.
