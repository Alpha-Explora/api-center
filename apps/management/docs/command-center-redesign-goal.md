# Command Center Redesign Goal

Last updated: 2026-06-15
Branch: `codex/command-center-redesign`
Primary repo: `C:\Codes\apic\apicenter-management`

## Goal

Redesign the APICenter management UI into a command center that helps teams understand service health, find the right workflow, inspect one strong service-detail record, and take the next safe action without jumping across disconnected pages.

The redesign is not just a visual refresh. It must improve how information is organized, how workflows connect, and how users recover from blocked or incomplete platform states.

## Product Principles

1. Use product and workflow language, not audience labels like `operator` or `executive`.
2. Prefer severity-first queues when showing issues, blockers, reviews, or actions.
3. Keep one primary service-detail drill-in with progressive disclosure instead of spreading service context across many isolated pages.
4. Every action-heavy page should answer:
   - What is happening?
   - What is blocked or risky?
   - What should I do next?
   - Where is the source evidence?
5. Empty, loading, error, and recovery states are part of the workflow, not afterthoughts.
6. Routes should remain functional and inspectable in the local browser before work is considered done.

## In Scope

### Global Information Architecture

- Keep the command-center sidebar organized around stable workflow groups:
  - Command
  - Services
  - Operations
  - Governance
  - Tools
- Make global search task-oriented, so users can search by workflow intent such as `rate limit`, `approval`, `evidence`, `SDK setup`, or `service health`.
- Avoid orphan routes. If a page remains, it needs a clear relationship to the service-detail spine or a clear standalone workflow reason.

### Overview And Issue Triage

- The overview should show platform health first.
- The primary action queue should be severity-first.
- Selecting an issue should reveal one strong detail surface with evidence, affected service, and next action.
- Mobile should preserve the same workflow through a drawer or equivalent focused detail surface.

### Service Detail Spine

The service detail page is the core drill-in. It should be the place where a service's state comes together across:

- Summary
- Health
- Dependencies
- Quotas
- Pipeline
- Governance
- Evidence
- Actions

Cross-page actions should route back into the most relevant service-detail section when the user is acting on a specific service.

### Workflow Pages

Each major workflow page should have a clear job:

- Registry: find and inspect service ownership and lifecycle state.
- Registration requests: approve, reject, or inspect pending service requests.
- Marketplace and API catalog: understand product availability and adoption, then route to service detail.
- Dependencies and shared services: show provider/consumer impact and route to the affected service.
- Quotas and plans: manage per-tribe API call limits and plan posture.
- Reliability, alerts, and readiness: show health, blockers, and recovery paths.
- Pipeline and cost: explain data movement, quality, S3/export posture, and usage demand.
- Compliance, audit, operational trust, and promotions: show governance evidence, approvals, and release gates.
- Developer portal and SDK runbook: support tribe-safe onboarding and request follow-through.
- Manifest tools, smoke tests, and settings: support validation, verification, and environment confidence.

### UX Quality Bar

- No page should depend on decorative layout alone to communicate priority.
- Tables, cards, and details should be scan-friendly and dense enough for repeated operational use.
- Controls need labels, accessible names, and stable layout at desktop and mobile sizes.
- Empty states should provide recovery actions where possible.
- Error states should explain what failed and what to check next.

## Out Of Scope

- Rebuilding backend APIs unless a UI workflow cannot be made sound without a backend contract change.
- Replacing the full design system.
- Adding decorative marketing-style pages.
- Splitting service detail into multiple competing detail pages.
- Making changes in sibling repos unless the UI goal exposes a real platform contract gap that must be fixed there.

## Completion Criteria

The redesign goal is complete only when all of these are true:

1. All primary routes load locally without runtime errors.
2. The overview has a severity-first action queue and focused selected-detail surface.
3. Service detail is the primary cross-product drill-in for service-specific workflows.
4. Major workflow pages route their service-specific actions back to service detail where appropriate.
5. Global search helps users find workflows by task intent, not only by exact page names.
6. No visible copy uses rejected audience labels such as `operator` or `executive`.
7. Empty/error states on major pages explain recovery paths.
8. Accessibility basics are covered for navigation, inputs, inspect buttons, and detail panels.
9. Desktop and mobile browser checks show no broken layout, overlapping text, or unusable workflow controls.
10. Tests, typecheck, lint, route smoke, and production build pass for the final branch state.

## Target State By Area

Use this table as the concrete contract for the redesign. If a row cannot be verified in the browser or with tests, it is not done.

| Area | Target user outcome | Required UI behavior | Verification |
| --- | --- | --- | --- |
| Shell and navigation | Users can understand where they are and move between platform workflows quickly. | Sidebar groups stay organized as Command, Services, Operations, Governance, and Tools. Active route is visible. Search is available globally. | Browser check any primary route at desktop and mobile widths. |
| Global search | Users can find tasks even when they do not know the route name. | Search accepts workflow language such as `rate limit`, `approval`, `evidence`, `SDK setup`, and `service health`, then routes to the correct workflow. | Component tests for aliases plus browser search smoke check. |
| Overview | Users see health, risk, and the next action before browsing detailed pages. | Platform health appears first. Action queue is severity-first. Selecting an issue opens a focused detail surface with evidence and next action. | Browser check `/`; no duplicate heading; selected issue detail works. |
| Service detail | Users can inspect one service's full operational state in one place. | `/tribes/[serviceId]` exposes summary, health, dependencies, quotas, pipeline, governance, evidence, and actions. Cross-page service actions deep-link into the relevant section. | Browser check service links from registry, marketplace, developer portal, quotas, and dependencies. |
| Registration and requests | Users can review and act on service onboarding without losing context. | New registration controls have accessible names. Request decisions expose service, evidence, and next action. | Component tests plus browser checks for `/tribes/new` and `/registration-requests`. |
| Quotas and plans | Users can understand limit posture and plan changes without guessing impact. | Quota and plan controls are labeled. Service-specific actions route to service detail or a clear quota detail surface. | Browser checks for `/quotas` and `/plans`; no unlabeled controls. |
| Shared services | Users can see provider/consumer impact and setup requirements. | Setup controls are labeled. Usage and dependency views link affected services back to service detail. | Browser checks for `/shared-services`, `/shared-services/setup`, and `/shared-services/usage`. |
| Reliability and readiness | Users can distinguish active incidents, blocked readiness, and recovery work. | Alerts and readiness pages show severity, impact, evidence, and recovery path. Empty states explain what to check next. | Browser checks for `/alerts`, `/reliability`, and `/readiness`. |
| Governance and promotion | Users can see approval, compliance, audit, trust, and promotion evidence. | Governance pages expose evidence and release gates without audience labels like `operator` or `executive`. | Browser checks for `/audit`, `/compliance`, `/operational-trust`, and `/promotions`; copy scan. |
| Developer support | Tribe developers can complete onboarding and follow through on requests. | Developer portal and SDK runbook connect setup, quotas, evidence, and service detail links. | Browser checks for `/developer-portal` and `/docs/consumer-runbook`. |
| Tools and validation | Users can validate manifests, smoke tests, and environment confidence. | Validation controls have labels. Results explain pass/fail state and next checks. | Browser checks for `/manifest-tools`, `/smoke-tests`, and `/settings`; no unlabeled controls. |

## Current Progress

Already implemented and pushed on this branch:

- Command-center shell and sidebar IA.
- Overview action queue and service-detail direction.
- Service-detail sections and legacy section aliases.
- Registry, alerts, lifecycle, quota, trust, marketplace, and developer-portal actions routing into service context.
- Overview alert-strip actions route service-scoped alerts into service health context.
- P4 route relationship audit documents service-specific deep links and intentional standalone workflows.
- Developer portal quota submission follow-up links to quota detail and evidence trail.
- `/tribes/new` shared service registration controls have explicit labels and tests.

## Current Known Gaps

These are the concrete gaps from the latest route QA pass and follow-up fixes:

| Priority | Gap | Routes | Current status | Done when |
| --- | --- | --- | --- | --- |
| P1 | Remaining workflow controls need accessible labels. | `/quotas`, `/plans`, `/shared-services/setup`, `/smoke-tests` | Fixed in branch | Browser unlabeled-control scan returns zero for each route and focused tests cover the changed controls. |
| P1 | Registration shared-service checkboxes needed labels. | `/tribes/new` | Fixed and pushed | Keep covered by `src/components/tribe-form.test.tsx`. |
| P2 | Empty states need concrete recovery paths. | `/alerts`, `/data-pipeline`, `/developer-portal` | Fixed in branch | Empty states tell the user what is missing, where to verify source data, and what action to take next. |
| P3 | Final mobile workflow fit still needs proof. | All primary routes | Fixed in branch | Mobile browser pass shows no overlapping text, horizontal overflow, hidden controls, or unusable detail surfaces. |
| P4 | Orphan workflows need a final relationship check. | Any route not tied to service detail or a standalone workflow | Fixed in branch | Each route either deep-links into service detail or has a documented standalone workflow purpose. |

## Active Work Queue

Work the remaining improvements in this order unless a stronger defect appears during QA:

1. Final verification complete.
2. Branch pushed to `origin/codex/command-center-redesign`.

## Final Verification Evidence

Latest verification on 2026-06-15:

- Focused regression tests: `src/components/dashboard-alert-strip.test.tsx`, `src/components/alerts-client.test.tsx`, `src/components/dashboard-client.test.tsx`, and `src/components/app-shell.test.tsx` passed, 10 tests total.
- Full test suite was run in chunks because the one-shot full run exceeded the terminal timeout:
  - `src/lib/**/*.test.ts` and `src/app/**/*.test.ts`: 55 files, 193 tests passed.
  - Component/page tests A-D: 24 files, 67 tests passed.
  - Component/page tests E-P: 19 files, 40 tests passed.
  - Component/page tests Q-Z: 25 files, 65 tests passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `git diff --cached --check` passed before commit.
- `npm run smoke:routes -- --base-url http://localhost:3010` passed for all 27 primary routes.
- `npm run build` passed.
- Browser checks verified `/` and `/tribes/payment?section=health` load without runtime errors or horizontal overflow. The current local registry API returned a recovery state, so live service-record browser proof was data-limited; route/link behavior is covered by component tests and code audit.
- Visible source-copy scan found no `operator review`, `operator reason`, or `executive` wording in non-test app/component files.

## Verification Plan

Use the smallest focused checks for each slice, then widen before pushing:

1. Focused component/unit tests for the changed workflow.
2. `npm run typecheck`
3. `npm run lint`
4. `git diff --check`
5. `npm run smoke:routes -- --base-url http://localhost:3010`
6. Browser check of the affected route and at least one related route.
7. `npm run build`

## Decision Rules

- If a page has many possible actions, keep one selected detail surface instead of stacking many expanded cards.
- If a workflow is service-specific, route to `/tribes/[serviceId]?section=...` instead of creating another isolated endpoint page.
- If a workflow is cross-platform, keep it as a page but make its relationship to service detail explicit.
- If implementation speed conflicts with workflow clarity, choose workflow clarity.
- If a change cannot be verified locally, do not count it as complete.
