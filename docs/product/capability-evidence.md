---
title: Capability documentation and evidence
status: canonical
authority: informative
owner: platform-maintainers
audience: [engineers, reviewers, operators, agents]
last_verified: "2026-11-19"
verification: repository
sources: [contracts/public, apps/docs/content/guides.json, packages/contracts/src/index.ts, docs/superpowers/plans/README.md]
---
# Capability documentation and evidence

This register distinguishes documentation coverage from implementation and runtime readiness. It is not a whole-platform completion score. A public page, contract, or historical deployment record does not establish current production readiness.

| Capability | Repository implementation and authority | Documentation coverage | Runtime evidence |
| --- | --- | --- | --- |
| Payments | Gateway facade and private payments runtime; [current ownership](../payments-platform-current.md) | Public OpenAPI, payment guides, SDK and contract checks | Live-provider, settlement, IAM, and database behavior require separate environment verification |
| Payment events | Pub/Sub delivery, outbox, and signed webhooks; [event operations](../integrations/payment-event-outbox-operations.md) | AsyncAPI (contract 2.0) and event/webhook guides | Historical records exist; delivery and replay need current consumer/provider evidence |
| Email, SMS, OTP | Independent runtimes and shared-service proxy | Authored integration guides, TypeScript contracts, and all supported shared HTTP operations in public OpenAPI | Provider delivery, approved senders, and production storage need current verification |
| Geo and Google Auth | Independent `geo`/`gauth` runtimes | Authored guides and supported shared HTTP operations in public OpenAPI | Provider credentials, OAuth configuration, and live calls remain environment-specific |
| Request diagnostics | Redacted per-request records and the console's Requests page | [Control plane operations](../operations/control-plane-operations.md) | Repository checks; deployment acceptance pending |
| Control plane | Organizations, projects, applications, grants, keys, budgets and live approval | Access and tenancy guides, control-plane runbook | Serbizio's test environment runs on it; live activation awaits approval |
| Management console | `apps/management`: every control-plane feature the gateway serves, gated by the console access policy the gateway enforces; [runbook](../../apps/management/docs/operations/apicenter-management-runbook.md) | Management guides, console README and DESIGN.md | Unit tests and builds; flows exercised against a local mock gateway on 2026-11-19. Use against a deployed gateway and real Google sign-in is unverified |
| Documentation governance | Canonical internal bundle, guide registry, contract-derived reference | Link/metadata/source audits, contract fidelity tests, and static-export checks | The workflow produces verified artifacts; public hosting is not verified here |

## Status vocabulary

Use **implemented** when code exists with the stated focused verification; **partial** when a named part remains missing; **planned** for approved future work; and **unverified** for behavior that has not been exercised in the stated environment. Record the exact check, revision, and environment with a delivery claim. Do not upgrade an entire capability because one slice passes.

## Remaining work

- Replace the removed release verifier with an application-key smoke check run after each deploy.
- Reconcile pending provider/deployment checks in the [working-document register](../superpowers/plans/README.md).
- Attach fresh deployment and provider evidence when updating historical operational records. A docs-only PR must not manufacture these results.
