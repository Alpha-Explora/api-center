# API Center Platform Lifecycle Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a platform-wide lifecycle spine that connects registry, runtime, quota, pipeline, promotion, and evidence workflows.

**Architecture:** Start with a derived lifecycle model in `apicenter-management`, then replace derived states with source-backed evidence from `api-center`, `api-shared-services`, and `control-tower`. Keep the service as the primary object and route all next actions to existing specialist pages.

**Tech Stack:** Next.js, React, TanStack Query, Vitest, API Center local management routes.

---

### Task 1: Derived Lifecycle Model

**Files:**
- Create: `src/lib/service-lifecycle.ts`
- Test: `src/lib/service-lifecycle.test.ts`

- [x] **Step 1: Write tests for ready, attention, and blocked lifecycle states**

Run: `npm test -- src/lib/service-lifecycle.test.ts`
Expected before implementation: FAIL because `src/lib/service-lifecycle.ts` does not exist.

- [x] **Step 2: Implement lifecycle stages**

Implement stages for registry, ownership, dependencies, runtime, quotas, pipeline, promotion, and evidence.

- [x] **Step 3: Verify tests pass**

Run: `npm test -- src/lib/service-lifecycle.test.ts`
Expected: PASS.

### Task 2: Lifecycle Panel

**Files:**
- Create: `src/components/platform-lifecycle-panel.tsx`
- Test: `src/components/platform-lifecycle-panel.test.tsx`

- [x] **Step 1: Write panel tests**

Run: `npm test -- src/components/platform-lifecycle-panel.test.tsx`
Expected before implementation: FAIL because the panel does not exist.

- [x] **Step 2: Render summary counts, service rows, stages, and next actions**

The panel must sort blocked services first and show an empty state when there are no registered services.

- [x] **Step 3: Verify tests pass**

Run: `npm test -- src/components/platform-lifecycle-panel.test.tsx`
Expected: PASS.

### Task 3: Overview And Developer Portal Integration

**Files:**
- Modify: `src/components/dashboard-client.tsx`
- Modify: `src/components/dashboard-client.test.tsx`
- Modify: `src/components/developer-portal-preview.tsx`
- Modify: `src/components/developer-portal-preview.test.tsx`

- [x] **Step 1: Add failing integration expectations**

Run: `npm test -- src/components/dashboard-client.test.tsx src/components/developer-portal-preview.test.tsx`
Expected before wiring: FAIL because lifecycle state is not rendered.

- [x] **Step 2: Wire the overview panel and portal lifecycle state**

The overview renders `PlatformLifecyclePanel`. The developer portal shows lifecycle state for owned services without exposing secrets.

- [x] **Step 3: Verify tests pass**

Run: `npm test -- src/components/dashboard-client.test.tsx src/components/developer-portal-preview.test.tsx`
Expected: PASS.

### Task 4: Lifecycle Route

**Files:**
- Create: `src/app/lifecycle/page.tsx`
- Create: `src/components/platform-lifecycle-client.tsx`
- Modify: `src/lib/app-navigation.ts`
- Modify: `src/components/app-shell.tsx`
- Modify: `scripts/smoke-routes.mjs`
- Modify: `scripts/smoke-routes.test.mjs`

- [x] **Step 1: Add failing smoke-route coverage**

Run: `npm test -- scripts/smoke-routes.test.mjs`
Expected before route update: FAIL because `/lifecycle` is missing.

- [x] **Step 2: Add route, nav entry, and client query wrapper**

The route fetches services, quota policies, and quota usage, then renders the same lifecycle panel.

- [x] **Step 3: Verify tests pass**

Run: `npm test -- scripts/smoke-routes.test.mjs`
Expected: PASS.

### Task 5: Next Backend Evidence Slice

**Files:**
- Modify later: `api-center` evidence/operations routes
- Modify later: `api-shared-services` smoke and SDK evidence publishing
- Modify later: `control-tower` promotion gate evidence publishing

- [ ] **Step 1: Define lifecycle evidence API contract**

Create a backend contract that returns one lifecycle entry per service with source-backed evidence sections.

- [ ] **Step 2: Replace derived UI pipeline/evidence states**

Update `src/lib/service-lifecycle.ts` to consume source-backed lifecycle evidence when available.

- [ ] **Step 3: Add cross-repo verification**

Run backend route tests, management component tests, and browser smoke across `/`, `/lifecycle`, `/developer-portal`, `/promotions`, and service detail.
