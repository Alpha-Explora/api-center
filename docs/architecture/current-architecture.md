---
title: Current APICenter architecture
status: canonical
authority: informative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "2026-10-10"
verification: repository
sources: [apps/gateway/src/app.module.ts, packages/contracts/src/index.ts, packages/runtime, apps/docs, infra/gcp]
---
# Current APICenter architecture

APICenter is a Turborepo monorepo with independently deployed runtimes. This map describes repository ownership, not a fresh verification of deployed services.

| Component | Ownership | Boundary |
| --- | --- | --- |
| `apps/gateway` | Authentication, service registry, routing, governance, compliance, quotas, and the public payment facade | Nest composition root; proxy calls cross runtime boundaries over HTTP |
| `apps/payments` | Provider calls, trusted principal enforcement, project/environment ownership, idempotency, webhooks, reconciliation, and payment outbox | Private provider adapter; public responses use APICenter IDs and contracts |
| `apps/email`, `apps/sms`, `apps/otp` | Delivery, verification, status, and durable service state | Authenticated shared-service gateway routes; provider credentials stay in runtime secrets |
| `apps/geo`, `apps/gauth` | Location and Google authentication integration | Independent shared-service runtimes |
| `apps/management` | Operator console | Uses gateway APIs rather than owning runtime business state |
| `apps/docs` | Curated static consumer docs | Registered MDX guides and public OpenAPI/AsyncAPI contracts; no root `docs/` ingestion |
| `packages/contracts` | Shared TypeScript contracts and pinned public contract artifacts | Gateway, runtimes, and SDK share these contracts |
| `packages/runtime` | Common runtime bootstrap and infrastructure helpers | Reused by independent service apps |
| `packages/sdk` | Published `@alpha-explora/apicenter-sdk` | Consumer transport and public integration operations |

Gateway domain roots live under `apps/gateway/src/domains/`: `auth-security`, `catalog-registry`, `compliance`, `gateway-proxy`, `governance`, `payments`, and `runtime-ops`. Shared infrastructure stays outside those domain roots. Respect the [boundary checks](../../scripts/check-boundaries.js) and [monorepo checks](../../scripts/check-monorepo-boundary.js).

## Data and provider ownership

PayMongo owns canonical provider-backed payment resources and merchant settlement. APICenter owns the project/environment resource mapping, recorded listing and reconciliation metadata, verified webhook receipts, and event delivery. AlphaCI owns its local billing/access projection. The detailed authority is [payments-platform-current.md](../payments-platform-current.md), supplemented by [database ownership](../operations/payment-database-ownership.md).

Payment commands go through the public gateway and SDK. Payment lifecycle events use Google Pub/Sub. Consumer services must not bypass the provider adapter with private credentials.

## Documentation flow

```text
Internal: AGENTS.md -> docs/index.md -> architecture / ADR / operations / evidence
Consumer: guides.json + MDX -> Fumadocs -> static guide pages
Reference: public OpenAPI / AsyncAPI -> endpoint / event pages and downloads
```

Guide aliases preserve replaced public paths. Old synthetic shared-operation pages now point to the maintained integration guides. Internal operational documents remain repository-only.

## Verification boundaries

Typecheck, unit tests, contract validation, docs builds, and boundary scans are repository checks. Provider behavior, database permissions, IAM, DNS, and deployment health need environment-specific evidence. Use [deployment guidance](../deployment-cloud-run.md), [platform setup](../apicenter-platform-setup.md), and the [capability register](../product/capability-evidence.md) without treating recorded snapshots as current state.
