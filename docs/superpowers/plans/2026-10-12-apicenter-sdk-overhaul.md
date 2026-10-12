---
title: "APICenter SDK overhaul implementation plan"
status: reference
authority: informative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "2026-10-12"
verification: repository
sources: ["docs/superpowers/specs/2026-10-12-apicenter-sdk-overhaul-design.md", "packages/sdk", "packages/contracts", "apps/gateway/src/domains/payments"]
---
# APICenter SDK Overhaul Implementation Plan

Implementation completed on 2026-10-12. The SDK was built and verified locally. Package publication and deployment were outside the implementation plan; the maintainer separately authorized the SDK release through this PR and the existing restricted GitHub Packages workflow.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the fragmented SDK with one server-side `ApiCenter` client that gives in-repository applications a clear, typed interface to APICenter shared services and payments.

**Architecture:** Reconcile the client against active routes and contracts first. Add one credential provider, HTTP transport, and error type. Expose service namespaces from one facade, migrate every in-repo caller, and remove the old clients. Keep APICenter as the authority for service placement, scopes, and authorization.

**Tech Stack:** TypeScript, Node.js 24, npm workspaces, Jest, `@apicenter/contracts`, NestJS gateway and service manifests, OpenAPI.

**Spec:** [APICenter SDK redesign specification](../specs/2026-10-12-apicenter-sdk-overhaul-design.md)

## Global Constraints

- The maintainer confirms there are no SDK consumers outside this repository for now. Migrate all repository callers together; do not retain compatibility adapters or deprecated aliases for the removed clients.
- Keep `@alpha-explora/apicenter-sdk` and its restricted GitHub Packages configuration. Prepare version `2.0.0` for the breaking API, but do not publish the package in this work.
- The SDK is for trusted server runtimes. Never put a service secret, refresh token, or privileged service token in browser examples or generated client bundles.
- Registry placement and gateway scopes remain authoritative. Do not add organization, tribe, or project headers/options that can override registry-derived authorization.
- Implement only operations confirmed by active gateway routes and runtime contracts. Do not change gateway authorization behavior or service runtime behavior as part of the SDK cleanup.
- `paymentApiKey` is optional. Payments use it only when explicitly configured; otherwise they use the configured service bearer. Do not retry requests automatically, especially mutations.
- Preserve existing user changes and unrelated workspace state. Do not reset, clean, or rewrite unrelated files.
- Treat package publication and deployment as separate operations that require explicit maintainer authorization.

## Review Focus

1. Refresh-token rotation and concurrent requests must use one in-flight refresh and must not reuse a consumed refresh token. Add coverage in the credential-provider tests.
2. Call options must not override `Authorization`, and a configured payment key must be selected only for payment calls. Add coverage in transport and facade tests.
3. Timeout, caller abort, empty body, malformed JSON, and non-success envelopes must produce predictable results. Add transport tests.
4. API errors must preserve status, APICenter code/details, and correlation ID without leaking secrets. Add error-envelope tests.
5. Mutations must not be replayed automatically; payment idempotency requirements and `202` resource responses must match the actual contract. Add operation tests.

---

### Task 1: Reconcile API contracts and SDK operation inventory

**Files:** `packages/contracts/apicenter-openapi.json`, `contracts/public/apicenter.openapi.yaml`, `packages/contracts/shared-service-contract.json`, `packages/contracts/src/**`, `apps/{email,sms,otp,geo,gauth,payments}/src/**`, `apps/gateway/src/domains/{auth-security,gateway-proxy,payments}/**`, `scripts/check-sdk-contracts.js`, contract tests under `tests/unit/contracts/`.

- [x] Trace each currently implemented shared-service operation to the gateway route, service runtime route, request/response DTO, required scope, and idempotency requirement. Record the canonical service namespace and method name for email, SMS, OTP, geo, Google Auth, and supported payment operations.
- [x] Reconcile payment operations against the active OpenAPI operations and gateway handlers. Mark unsupported, stale, or unverified hand-authored methods for removal instead of preserving them by assumption.
- [x] Add or complete contract-owned request and response types for verified shared-service operations in `@apicenter/contracts`; keep route/wrapper inventory aligned with runtime manifests. Do not invent schemas where the runtime has none—record the gap and keep that operation out of the typed SDK until resolved.
- [x] Add contract checks that fail when an exported SDK operation has no active route/contract, or when a required supported route loses its SDK mapping. Retain payment event schema validation.
- [x] Add focused contract tests for route coverage, auth metadata, and contract-derived request/response types. Run `npm run contracts:validate`, the focused contract Jest test, and `npm run check:sdk-contracts`; confirm the new checks fail when a route or operation mapping is deliberately missing, then restore the source.

### Task 2: Add shared transport, errors, and credential providers

**Files:** `packages/sdk/src/internal/transport.ts`, `packages/sdk/src/internal/errors.ts`, `packages/sdk/src/internal/auth/**`, `packages/sdk/src/types.ts`, `packages/sdk/tests/unit/transport.test.ts`, `packages/sdk/tests/unit/auth-provider.test.ts`, `packages/sdk/tests/unit/errors.test.ts`.

- [x] Define the constructor shape: `ApiCenterOptions` has `baseUrl`, optional `auth` (registered service credentials `{ serviceId, environment, secret }` or `{ getAccessToken }`), optional `paymentApiKey`, `fetchImpl`, and `timeoutMs`. Require at least one usable credential; allow payment-key-only configuration for payment-only callers.
- [x] Implement a service credential provider against `POST /api/v1/auth/token` and `POST /api/v1/auth/token/refresh`. Cache tokens until a short pre-expiry window, refresh once for concurrent callers, store rotated refresh tokens, and surface refresh failure without replaying the protected request. If the issuer provides no refresh token, reacquire with the registered service credentials.
- [x] Implement caller-supplied async access-token support without copying, logging, or persisting the caller’s token.
- [x] Implement one JSON transport for URL normalization, bearer injection, request encoding, response parsing, `AbortSignal`, timeout, safe headers, empty responses, and APICenter envelope validation. Reject caller attempts to set `Authorization` through per-call headers.
- [x] Implement and export one `ApiCenterError` with `status`, `code`, safe `details`, and `correlationId` when supplied by the gateway response or headers. Exclude credentials and tokens from error properties and messages.
- [x] Add unit tests for token issuance, early refresh, refresh rotation, concurrent refresh, provider callbacks, payment-key-only setup, auth-header protection, timeout/abort, malformed and empty bodies, non-JSON failures, and correlation metadata. Run SDK typecheck and the focused SDK test files.

### Task 3: Implement shared-service namespaces

**Files:** `packages/sdk/src/services/email.ts`, `sms.ts`, `otp.ts`, `geo.ts`, `google-auth.ts`, `packages/sdk/src/ApiCenter.ts`, relevant files under `packages/sdk/tests/unit/`.

- [x] Build the `ApiCenter` facade around the shared transport and contract-owned types. Expose `email`, `sms`, `otp`, `geo`, and `googleAuth` namespaces.
- [x] Implement only operations validated in Task 1: send/status, OTP generate/verify/status, geocode/reverse-geocode/geofence, and Google Auth authorize/exchange/refresh/logout. Require an `idempotencyKey` option for email send, SMS send, OTP generate, and OTP verify; validate the gateway’s accepted length and set `Idempotency-Key` internally. Use concise resource names such as `email.send()` and `otp.verify()` while preserving exact route paths and wire bodies.
- [x] Fail locally with a clear configuration error if a shared-service operation is called without a service-token provider; never fall back to a payment API key for shared-service calls.
- [x] Add tests for every namespace’s route, method, encoded path parameters, typed request/response, and bearer selection. Cover service-only initialization without a payment key. Run SDK typecheck and the namespace test files.

### Task 4: Move supported payments behind the shared facade

**Files:** `packages/sdk/src/services/payments/**`, `packages/sdk/src/ApiCenter.ts`, `packages/sdk/src/types.ts`, `packages/sdk/tests/unit/payments/**`.

- [x] Add `apicenter.payments` resource groups for only verified payment operations: checkouts, intents, customers, plans, payment links, refunds, subscriptions, invoices, records, and capabilities.
- [x] Derive public input/output types from `@apicenter/contracts`; remove duplicate or unsupported hand-authored payment shapes identified in Task 1.
- [x] Route payment calls through the common transport. Use `paymentApiKey` when explicitly configured, otherwise use the configured service bearer. Keep payment-key configuration and service scopes explicit in docs and types.
- [x] Enforce idempotency keys only on operations whose gateway contract requires them. Preserve `202` pending resources and response envelopes as documented return types. Keep retries disabled.
- [x] Add tests for the verified operations, auth selection, required idempotency keys, pagination/query encoding, `202` results, and error propagation. Run SDK typecheck and the payment test files.

### Task 5: Remove legacy clients and migrate all repository callers

**Files:** `packages/sdk/src/index.ts`, `packages/sdk/src/TribeClient.ts`, `packages/sdk/src/internal/payment.ts`, `packages/sdk/src/internal/shared-services.ts`, `packages/sdk/src/payments.ts`, `packages/sdk/tests/unit/**`, `README.md`, `examples/sandbox/demand-service/**`, `scripts/smoke/payment-platform-smoke.ts`, `apps/management/src/lib/service-onboarding.ts`, `apps/gateway/src/app.module.ts`, `apps/docs/components/**`.

- [x] Export `ApiCenter`, `ApiCenterError`, contract types, and payment event parsing/schema from the package entry point. Remove `TribeClient`, `PaymentsClient`, `SharedServicesClient`, obsolete option types, and old implementation files after callers are migrated.
- [x] Move the sandbox to the versioned SDK workspace and new API. Preserve its logistics and Geo behavior; keep unsupported generic Kafka publishing explicitly unavailable until APICenter defines a contract. Update management-generated snippets and gateway comments to use supported namespaces.
- [x] Migrate the payment smoke script and SDK tests to the new facade and method names. Remove old test fixtures that only validate deleted aliases, retaining their relevant transport and behavior assertions in the new test suites.
- [x] Search the whole repository for `TribeClient`, `PaymentsClient`, `SharedServicesClient`, `@apicenter/sdk`, and `ApiCenterClient`; remove stale SDK usage and retain only historical references that are clearly marked as such.
- [x] Run package build, SDK typecheck/tests, `npm run check:sdk-contracts`, `npm run check:boundaries`, and `npm run check:monorepo`.

### Task 6: Update the canonical quickstart and prepare the breaking package version

**Files:** `packages/sdk/README.md`, `apps/docs/content/docs/sdk-usage.mdx`, `apps/docs/components/vercel-api-doc.tsx`, `apps/docs/components/api-doc-layout.tsx`, `README.md`, `packages/sdk/package.json`, `package-lock.json`, SDK consumer fixture/tests.

- [x] Make the package README and SDK guide share one quickstart covering GitHub Packages setup, server-only environment variables, email or SMS, OTP, payment auth and scope requirements, error handling, and test/live selection.
- [x] Replace generated TypeScript snippets with examples that compile against the package exports. Remove the incorrect `@apicenter/sdk` and `ApiCenterClient` snippets.
- [x] Add a package consumer fixture that compiles the documented imports and calls. Verify the current CommonJS and ESM consumption paths before changing module output; change output only if the fixture demonstrates a real failure.
- [x] Set the package source version to `2.0.0` and synchronize the lockfile. Leave publication to a separately authorized release operation.
- [x] Run the consumer fixture, SDK build/typecheck/tests, `npm run check:documentation`, `npm run test:documentation`, `npm run docs:build`, and `npm run docs:test`.

### Task 7: Final repository validation and documentation reconciliation

**Files:** changed SDK, contract, test, and docs files; [SDK redesign specification](../specs/2026-10-12-apicenter-sdk-overhaul-design.md); [plan register](README.md).

- [x] Run `npm run build`, `npm run typecheck`, `npm run check:contracts`, `npm run check:boundaries`, `npm run check:monorepo`, `npm run check:documentation`, `npm run docs:build`, and `npm run docs:test` after the focused suites pass.
- [x] Inspect the final diff for removed legacy exports, actual contract coverage, secret leakage in docs/errors, dependency/version consistency, and accidental unrelated changes.
- [x] Record exact commands and results in the implementation report. The package was unpublished at implementation completion; record any later authorized release separately.

## Verification note

All focused SDK, payment-contract, documentation-build, documentation-test, root build, root typecheck, and monorepo boundary checks completed successfully. The repo-wide `npm run check:documentation` still reports invalid `authority` and `verification` metadata in the pre-existing, untracked `docs/operations/cloud-live-status-2026-10-12.md`; that Cloud Run record was left unchanged because it is outside this SDK task.
