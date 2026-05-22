# Raw To Silver Run Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an operator button in `apicenter-management` that starts a bounded Raw -> Bronze -> Common Silver validation/materialization run for a selected tribe and partition.

**Architecture:** API Center owns the Athena execution because it already has the deployed AWS runtime and guarded admin endpoints. Management adds a local proxy, client schema, and Runs tab that previews or starts the API Center workflow without exposing AWS credentials to the browser.

**Tech Stack:** NestJS, Athena SDK runner, Next.js App Router route handlers, TanStack Query, Vitest/Jest, shadcn UI primitives.

---

### Task 1: API Center Raw To Silver Run Endpoint

**Files:**
- Create: `api-center/src/data-pipeline/raw-to-silver-run.service.ts`
- Create: `api-center/src/data-pipeline/raw-to-silver-run.service.spec.ts`
- Modify: `api-center/src/data-pipeline/pipeline-health.controller.ts`
- Modify: `api-center/src/data-pipeline/data-pipeline.module.ts`

- [ ] Write failing service tests for preview and execution with a mocked Athena runner.
- [ ] Implement request validation, SQL construction, preview response, raw count, Bronze count, Common Silver count, and optional CTAS materialization.
- [ ] Wire the service into `POST /data-pipeline/raw-to-silver-runs`.
- [ ] Run `npm test -- src/data-pipeline/raw-to-silver-run.service.spec.ts --runInBand`.

### Task 2: Management Proxy And Client Contract

**Files:**
- Create: `apicenter-management/src/app/api/local/data-pipeline/raw-to-silver-runs/route.ts`
- Create: `apicenter-management/src/app/api/local/data-pipeline/raw-to-silver-runs/route.test.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/lib/api-center-client.ts`

- [ ] Write failing route/schema tests for proxying the request to API Center.
- [ ] Add Zod schemas and client helper for preview/start calls.
- [ ] Implement the route using `apiCenterAdminRequest`.
- [ ] Run the focused Vitest route/schema tests.

### Task 3: Runs Tab Button

**Files:**
- Create: `apicenter-management/src/components/raw-to-silver-run-panel.tsx`
- Create: `apicenter-management/src/components/raw-to-silver-run-panel.test.tsx`
- Modify: `apicenter-management/src/components/data-pipeline-dashboard-client.tsx`

- [ ] Write failing UI test for the Runs tab and preview/start button behavior.
- [ ] Add the Runs tab and panel with environment/date defaults from the dashboard.
- [ ] Support preview, start, optional materialization, loading state, errors, and result summary.
- [ ] Run focused component tests.

### Task 4: Verification

- [ ] Run API Center focused tests and typecheck.
- [ ] Run management focused tests and typecheck.
- [ ] Run management build if typecheck passes.
