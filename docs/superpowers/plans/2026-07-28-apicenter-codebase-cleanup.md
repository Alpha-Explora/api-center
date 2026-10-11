---
title: "APICenter Codebase Structure Cleanup Implementation Plan"
status: active
authority: informative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "unverified"
verification: unverified
sources: ["AGENTS.md","docs/architecture/current-architecture.md"]
---
# APICenter Codebase Structure Cleanup Implementation Plan

This working document preserves prior scope and checklists. It does not establish current deployment state or override the maintained docs bundle. See [the working-document register](../plans/README.md) for verification gaps and disposition.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the APICenter monorepo easier to navigate and change by completing its bounded-context model, reducing gateway coupling, and preserving independently runnable apps at every phase.

**Architecture:** Keep deployable applications under `apps/` and published/shared contracts under `packages/`. Inside `apps/gateway`, organize around bounded contexts and stable Nest module interfaces; keep infrastructure in a small shared kernel and move implementation details behind context-owned seams. Use an incremental strangler approach: each phase keeps existing routes, package names, and entrypoints intact until the replacement has tests and passes the repository checks.

**Tech Stack:** NestJS 11, TypeScript 6, npm workspaces, Turborepo, Jest, Prisma/Supabase, Express runtime apps, Cloud Run.

## Global Constraints

- Keep `apps/gateway/src/main.ts` as the gateway entrypoint and keep `npm run dev`, `npm run build`, and `npm run start:prod` valid after every phase.
- Keep each runtime under `apps/<runtime>` independently deployable; do not merge email, SMS, OTP, geo, payments, or gateway into one process.
- Preserve public HTTP routes, SDK contracts, service manifests, database schema ownership, and Cloud Run service names unless a separate migration is approved.
- Do not make `apps/gateway/src/shared` a second business domain; only generic, cross-context code belongs there.
- Every phase must finish with `npm run check:monorepo`, `npm run typecheck`, and `npm run lint`; boundary and focused tests must run when their files change.

### Task 0: Retire Unused Data Pipeline, Kafka, and Confluent Infrastructure

**Files:**
- [DELETE] `apps/gateway/src/data-pipeline/`
- [DELETE] `apps/gateway/src/kafka/`
- [DELETE] `apps/gateway/src/kafka-governance/`
- [DELETE] `tests/unit/src/data-pipeline/`
- [DELETE] `tests/unit/src/kafka/`
- [DELETE] `tests/unit/src/kafka-governance/`
- Modify: `apps/gateway/src/app.module.ts`
- Modify: `apps/gateway/src/health/health.controller.ts`
- Modify: `apps/gateway/src/auth/auth.controller.ts`
- Modify: `apps/gateway/src/registry/registry.service.ts`
- Modify: `apps/gateway/src/external/external.service.ts`
- Modify: `apps/gateway/src/registry/health-monitor.service.ts`
- Modify: `apps/gateway/src/shared/interceptors/audit-log.interceptor.ts`
- Modify: `apps/gateway/src/config/config.service.ts`
- Modify: `scripts/check-boundaries.js`
- Modify: `package.json`

**Interfaces:**
- Produces: Gateway codebase with all unneeded Kafka, Confluent, and Athena Data-Pipeline components cleanly excised; Pub/Sub payment and shared-service flows remain active.

- [ ] **Step 1: Remove unneeded Nest modules from composition.**
  Remove `DataPipelineModule`, `KafkaModule`, and `KafkaGovernanceModule` from `apps/gateway/src/app.module.ts`.

- [ ] **Step 2: Decouple gateway controllers and services from KafkaService.**
  Remove `KafkaService` dependency and publishing logic from `HealthController`, `AuthController`, `RegistryService`, `ExternalService`, `HealthMonitorService`, and `AuditLogInterceptor`.

- [ ] **Step 3: Remove source files and unit tests.**
  Delete the directories `apps/gateway/src/data-pipeline/`, `apps/gateway/src/kafka/`, `apps/gateway/src/kafka-governance/`, and their corresponding test folders under `tests/unit/src/`.

- [ ] **Step 4: Clean up config, boundary scripts, and dependencies.**
  Remove `kafka` and `dataPipeline` configurations from `apps/gateway/src/config/config.service.ts`. Remove `data_pipeline_governance` from `scripts/check-boundaries.js`. Remove `@aws-sdk/client-athena`, `@aws-sdk/credential-providers`, and `kafkajs` from `package.json`.

- [ ] **Step 5: Verify.**
  Run `npm run check:boundaries`, `npm run typecheck`, `npm run lint`, and `npm run test` to verify the codebase compiles cleanly without Kafka or Data Pipeline dependencies.

### Task 1: Establish the Current Ownership Model

**Files:**
- Modify: `scripts/check-boundaries.js`
- Modify: `tests/integration/scripts/check-boundaries.test.js`
- Create: `docs/architecture/codebase-map.md`
- Modify: `docs/developer/README.md`

**Interfaces:**
- Produces: one explicit owner for every gateway source area and every Prisma schema; boundary checks fail when a new area is unowned.

- [ ] **Step 1: Add the missing bounded-context owners.**

Add explicit contexts for gateway transport (`tribes`, `external`, `shared-services`), payments control (`apps/gateway/src/payments`), and the payment data-plane app (`apps/payments`) with schema `shared_payment`. Assign the remaining small areas (`capabilities`, `costs`, `deprecations`, `promotions`, and `types`) either to an existing context or to a named platform context; do not leave them implicitly unowned.

- [ ] **Step 2: Add regression cases.**

Extend `tests/integration/scripts/check-boundaries.test.js` with one passing case for the payment Prisma schema and one failing case for a source file importing an internal payment-control implementation from another context.

- [ ] **Step 3: Document the map.**

Document the app/package tree, context owners, public interfaces, and allowed dependency direction in `docs/architecture/codebase-map.md`. Link it from `docs/developer/README.md` and state that the map is the source for future structural changes.

- [ ] **Step 4: Verify.**

Run `npm run check:boundaries`, `npm run check:boundaries:test`, `npm run check:monorepo`, `npm run typecheck`, and `npm run lint`. The live boundary check must pass before any directory move begins.

### Task 2: Make Gateway Composition Explicit

**Files:**
- Modify: `apps/gateway/src/app.module.ts`
- Modify: `apps/gateway/src/main.ts`
- Create: `apps/gateway/src/bootstrap/gateway-modules.ts`
- Create: `apps/gateway/src/bootstrap/gateway-middleware.ts`
- Test: `tests/unit/src/bootstrap/gateway-composition.spec.ts`

**Interfaces:**
- Produces: `gatewayModules()` returning the ordered Nest module imports and `configureGatewayMiddleware(consumer)` containing only process-wide middleware setup.

- [ ] **Step 1: Characterize the current composition.**

Write a test that asserts the composition includes configuration, shared kernel, auth, registry, routing, health, observability, governance, and payments modules, and that the middleware registration remains process-wide.

- [ ] **Step 2: Extract assembly helpers.**

Move only the import list and middleware chain out of `app.module.ts`; keep `AppModule` as the thin composition root. Do not change module providers, exports, routes, or startup order.

- [ ] **Step 3: Verify the running shape.**

Run the focused composition test, `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, and `npm run build`. If build output is locked by the environment, run it in a writable workspace and record that limitation rather than treating it as a code failure.

### Task 3: Shrink the Shared Kernel

**Files:**
- Modify: `apps/gateway/src/shared/shared.module.ts`
- Modify: `apps/gateway/src/shared/`
- Create: `apps/gateway/src/platform/http/`
- Create: `apps/gateway/src/platform/observability/`
- Create: `apps/gateway/src/gateway-routing/`
- Modify: imports and tests that currently consume `shared/proxy-handler`, `shared/proxy/*`, or process-wide middleware.

**Interfaces:**
- Produces: a small shared kernel containing only cross-context errors, logger, request middleware, and common primitives; gateway routing owns proxy orchestration and proxy adapters.

- [ ] **Step 1: Move the proxy seam first.**

Move `proxy-handler.ts` and the `shared/proxy` implementation behind a gateway-routing interface. Preserve the existing request/response behavior and keep the controllers calling one routing module rather than importing registry, auth, analytics, quota, policy, and operations internals directly.

- [ ] **Step 2: Move HTTP and observability utilities.**

Group filters, interceptors, middleware, logger, and Redis throttler storage under `platform/http` and `platform/observability` only where their callers are process-wide. Keep DTOs and domain errors out of these folders.

- [ ] **Step 3: Replace imports through public seams.**

Update aliases and imports so context code imports a module, DTO, type, or port instead of a file deep inside another context. Keep compatibility re-exports temporarily where they reduce the migration risk, then delete them after all callers move.

- [ ] **Step 4: Verify.**

Run proxy, middleware, interceptor, and health-path unit tests, then `npm run check:boundaries`, `npm run typecheck`, `npm run lint`, and `npm run build`.

### Task 4: Deepen the Registry and Identity Seams

**Files:**
- Modify: `apps/gateway/src/registry/registry.service.ts`
- Modify: `apps/gateway/src/auth/auth.service.ts`
- Create: `apps/gateway/src/registry/registry-reader.port.ts`
- Create: `apps/gateway/src/registry/registry-writer.port.ts`
- Create: `apps/gateway/src/auth/identity-reader.port.ts`
- Modify: `apps/gateway/src/registry/registry.module.ts`
- Modify: `apps/gateway/src/auth/auth.module.ts`
- Test: existing registry/auth specs plus focused port contract specs.

**Interfaces:**
- Produces: small read/write interfaces for callers; Redis/Postgres/bootstrap/secret-resolution details remain internal adapters of the owning context.

- [ ] **Step 1: Characterize existing behavior.**

Add tests around registration lookup, service health lookup, token issuance/validation, and the current fallback behavior before splitting implementations.

- [ ] **Step 2: Extract the read and write seams.**

Keep the public Nest providers stable while delegating to ports. The gateway-routing context may depend on `RegistryReader`; onboarding/admin flows may depend on `RegistryWriter`; neither should know the store implementation.

- [ ] **Step 3: Remove avoidable module cycles.**

Use the new ports and events/read models to reduce `forwardRef` usage between auth, registry, approvals, and quotas. Remove a `forwardRef` only after the focused module-wiring test proves the same provider graph.

- [ ] **Step 4: Verify.**

Run all auth and registry unit tests, module-wiring tests, `npm run check:boundaries`, `npm run typecheck`, `npm run lint`, and `npm run build`.

### Task 5: Split Large Context Implementations Without Changing Routes

**Files:**
- Modify: `apps/gateway/src/operations/`
- Modify: `apps/gateway/src/analytics/`
- Modify: `apps/gateway/src/payments/`
- Test: the existing tests under `tests/unit/src/operations`, `tests/unit/src/analytics`, and `tests/unit/src/payments`.

**Interfaces:**
- Produces: context-owned application services with pure builders/validators separated from I/O adapters; controllers depend on use-case interfaces rather than large services.

- [ ] **Step 1: Split one behavior at a time.**

Start with `registry.service.ts`, `shared/proxy-handler.ts`, and `service-lifecycle-evidence.service.ts`, which are the largest current files. Extract one cohesive behavior per change: validation, policy decision, persistence, or external publication.

- [ ] **Step 2: Keep side effects behind adapters.**

Pass database, Pub/Sub, HTTP, and clock dependencies into the extracted module. Pure decision modules return values; adapters perform writes or network calls.

- [ ] **Step 3: Preserve controller contracts.**

Do not rename routes or DTOs during this phase. Controllers should become thin composition adapters and retain the existing response/error semantics.

- [ ] **Step 4: Verify each slice.**

Run the affected focused tests first, then the full typecheck/lint/boundary suite. Only merge a slice when its context tests and gateway build pass.

### Task 6: Align Workspace and Documentation Structure

**Files:**
- Modify: `package.json`
- Modify: workspace `package.json` files under `apps/*` and `packages/*`
- Modify: `turbo.json`
- Modify: `README.md`
- Modify: `docs/adr/0007-apicenter-turborepo-monorepo.md`
- Modify: `docs/developer/README.md`

**Interfaces:**
- Produces: predictable workspace scripts and a single documented map of app entrypoints, package ownership, test commands, and deployment units.

- [ ] **Step 1: Normalize commands.**

Give every deployable app consistent `dev`, `start`, `typecheck`, `lint`, and `test` names where they are meaningful. Keep app-specific database/deployment commands local to the owning workspace.

- [ ] **Step 2: Make Turbo tasks accurate.**

Ensure `turbo.json` task dependencies and outputs match each workspace’s actual build/typecheck/test behavior; do not claim a task covers an app it does not inspect.

- [ ] **Step 3: Update the docs.**

Document the final layout, the difference between gateway control-plane code and runtime apps, the package dependency direction, and the verification gate for future moves.

- [ ] **Step 4: Verify the whole repository.**

Run `npm run check:monorepo`, `npm run check:boundaries`, `npm run typecheck`, `npm run lint`, `npm run check:contracts`, `npm run contracts:validate`, `npm run sdk:build`, and the affected workspace tests.

## Recommended Order

Run Task 0 first to retire unused Kafka and Data Pipeline infrastructure. Then run Task 1. Do Task 2 before any physical restructuring, Task 3 around the proxy seam, Task 4 around registry/auth, and Task 5 one context slice at a time. Do Task 6 after the structural changes settle so the docs describe the resulting shape rather than a speculative target.

Do not begin by renaming every folder. The current repository already has independently deployable apps and a partial bounded-context guard; the highest-leverage cleanup is to complete the ownership model and make the gateway’s interfaces deeper before moving files.

## Self-Review Checklist

- [ ] Retired Kafka, Confluent, and Athena Data-Pipeline components are completely removed in Task 0.
- [ ] Every remaining source directory and database schema has one documented owner.
- [ ] No context imports another context’s internal implementation.
- [ ] `apps/gateway/src/shared` contains no business-domain orchestration.
- [ ] Gateway controllers depend on context interfaces and DTOs.
- [ ] Public routes, SDK contracts, service manifests, and deployment entrypoints are unchanged.
- [ ] Typecheck, lint, boundary checks, focused tests, and gateway build pass after every phase.

## Accepted Refinement

This plan keeps APICenter as one modular NestJS monolith plus independently deployable runtime apps. It does not introduce a new multi-repo architecture or merge the gateway and runtime apps into one process.

Use the actual gateway source root `apps/gateway/src`; older `src/...` references are conceptual shorthand only. Keep the existing top-level bounded contexts and improve their internal seams before physically regrouping directories.

The internal ownership model is:

```text
Runtime gateway:
  auth, registry, tribes, shared-services, external,
  gateway-control-plane/proxy

Governance/control plane:
  approvals, policy, quotas, entitlements, developer-portal

Catalog and payments control:
  catalog remains with registry/catalog ownership;
  gateway payments remains its own payments-control context;
  apps/payments remains the separate payment data-plane app

Data and operations:
  analytics, operations, compliance, health, forecasting

Platform:
  config, database, shared, metrics, contracts, types
```

Apply these refinements to the existing tasks:

- Task 0 removes retired Kafka, Confluent, and Athena Data-Pipeline components first.
- Proxy extraction is the first internal refactor after Task 0. Move or re-export shared/proxy-handler.ts and shared/proxy/* behind apps/gateway/src/gateway-control-plane/proxy/. Create an injected ProxyOrchestrator; TribesController and SharedServicesController must stop constructing new ProxyHandler(...) directly.
- Keep proxy decision collaborators internal to the orchestrator rather than exposing every decision as a Nest provider.
- Registry extraction is second. Keep RegistryService as a compatibility facade while introducing RegistryReader and RegistryWriter; use the existing store, bootstrap, health, secret, and registration-request files as the first seams.
- AppModule aggregation is third. Add apps/gateway/src/modules/gateway-runtime.module.ts, governance.module.ts, operations.module.ts, and public-api.module.ts; then reduce AppModule to composition.
- Aggregation alone does not remove forwardRef cycles; ports and read models from the proxy/registry work do.
- Contracts and config cleanup comes later. Split apps/gateway/src/types/index.ts into context-owned contracts under apps/gateway/src/contracts/auth, registry, events, and http.
- Keep packages/contracts reserved for public cross-application artifacts.
- Narrow shared to generic HTTP, logging, security, and runtime utilities, and expose typed config sections for auth, registry, and payments.
