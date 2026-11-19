---
title: Current APICenter architecture
status: canonical
authority: informative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "2026-11-19"
verification: repository
sources: [apps/gateway/src/app.module.ts, packages/contracts/src/index.ts, packages/runtime, apps/docs, infra/gcp]
---
# Current APICenter architecture

APICenter is a Turborepo monorepo with independently deployed runtimes. This map describes repository ownership, not a fresh verification of deployed services.

| Component | Ownership | Boundary |
| --- | --- | --- |
| `apps/gateway` | The control plane (organizations, projects, applications, grants, keys, budgets), the capability and published-API proxies, the public payment facade, event destinations, and request diagnostics | Nest composition root; proxy calls cross runtime boundaries over HTTP with a signed runtime context |
| `apps/payments` | Provider calls, trusted principal enforcement, project/environment ownership, idempotency, webhooks, reconciliation, and payment outbox | Private provider adapter; public responses use APICenter IDs and contracts |
| `apps/email`, `apps/sms`, `apps/otp` | Delivery, verification, status, and durable service state | Authenticated shared-service gateway routes; provider credentials stay in runtime secrets |
| `apps/geo`, `apps/gauth` | Location and Google authentication integration | Independent shared-service runtimes |
| `apps/webhooks` | Signed HTTPS delivery of payment events to an application's webhook destination | Pushed by Pub/Sub; refuses private addresses; signing secrets in Secret Manager |
| `apps/management` | Console for projects and their test/live environments: applications, grants, keys, capability settings, webhooks, published APIs, quotas, workload identities, project roles, people, going live, and request diagnostics | Calls the control-plane admin API as the signed-in member; owns no business state |
| `apps/docs` | Curated consumer and Management guides | Registered MDX guides and public OpenAPI/AsyncAPI contracts; no root `docs/` ingestion |
| `packages/contracts` | Shared TypeScript contracts and pinned public contract artifacts | Gateway, runtimes, and SDK share these contracts |
| `packages/runtime` | Common runtime bootstrap and infrastructure helpers | Reused by independent service apps |
| `packages/sdk` | Published `@alpha-explora/apicenter-sdk` | Consumer transport and public integration operations |

Gateway domain roots live under `apps/gateway/src/domains/`: `auth-security` (the platform credential guard), `compliance` (audit events), `control-plane`, `gateway-proxy` (shared-service and published-API proxies, provider webhooks), `governance` (approvals), `payments`, and `runtime-ops` (health and request diagnostics). Shared infrastructure stays outside those domain roots. Respect the [boundary checks](../../scripts/check-boundaries.js) and [monorepo checks](../../scripts/check-monorepo-boundary.js).

## Control plane

Organizations own projects directly. A project has separate `test` and `live` environments. Each environment holds its own applications (backend identities), explicit grants on catalogued capability actions or published-API actions, application keys (`ak_test_…`, `ak_live_…`, stored only as verifiers) and optional workload-identity bindings, plans and request budgets, capability configuration, published APIs and event destinations. Console roles (owner, admin, developer, viewer), optional teams and project roles govern people; grants govern applications. Code: `apps/gateway/src/domains/control-plane`.

Request path: the gateway resolves the credential to exactly one application, checks organization, project, environment and application status, the catalogued action, the enabled capability or published API and an explicit grant, reserves every applicable budget atomically, and forwards a 60-second Ed25519-signed runtime context (`X-APICenter-Context`) instead of identity headers. Runtimes and publishers verify it for their own audience. Control-plane rows are protected by PostgreSQL row-level security per organization.

The application key is the only consumer credential: the legacy service registry, service tokens, payment API keys and tribes were removed on 2026-11-19 (SDK 3.0, payment event contract 2.0). Operations: [control plane operations](../operations/control-plane-operations.md).

## Data and provider ownership

PayMongo owns canonical provider-backed payment resources and merchant settlement. APICenter owns the project/environment resource mapping, recorded listing and reconciliation metadata, verified webhook receipts, and event delivery. A consuming service owns its local business and access projection. No consumer repository outside APICenter is currently onboarded to the published SDK. The detailed authority is [payments-platform-current.md](../payments-platform-current.md), supplemented by [database ownership](../operations/payment-database-ownership.md).

Payment commands go through the public gateway and SDK. Payment lifecycle events use Google Pub/Sub, delivered to each application's event destination: a Pub/Sub push subscription or a signed HTTPS webhook (`apps/webhooks`). Consumer services must not bypass the provider adapter with private credentials.

## Operational evidence

The gateway records redacted request diagnostics (application, route template, status, failure stage; no bodies, query strings or credentials) and usage per application in `cp_usage_records`. The private payment runtime owns replay attempts and original event snapshots. The console reads diagnostics through the platform-operator route `GET /api/v1/admin/operations/requests`.

## Documentation flow

```text
Internal: AGENTS.md -> docs/index.md -> architecture / ADR / operations / evidence
Consumer and Management: guides.json + MDX -> Fumadocs -> static guide pages
Reference: public OpenAPI / AsyncAPI -> endpoint / event pages and downloads
```

Guide aliases preserve replaced public paths. Old synthetic shared-operation pages now point to the maintained integration guides. Internal operational documents remain repository-only.

## Verification boundaries

Typecheck, unit tests, contract validation, docs builds, and boundary scans are repository checks. Provider behavior, database permissions, IAM, DNS, and deployment health need environment-specific evidence. Use [deployment guidance](../deployment-cloud-run.md), [platform setup](../apicenter-platform-setup.md), and the [capability register](../product/capability-evidence.md) without treating recorded snapshots as current state.

### Runtime identity and health sweeps

Payment proxy requests carry distinct APICenter runtime and Cloud Run identities. Google ID-token verification checks the client registered for the requested project and environment. 
