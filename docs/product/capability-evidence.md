---
title: Capability documentation and evidence
status: canonical
authority: informative
owner: platform-maintainers
audience: [engineers, reviewers, operators, agents]
last_verified: "2026-10-10"
verification: repository
sources: [contracts/public, apps/docs/content/guides.json, packages/contracts/src/index.ts, docs/superpowers/plans/README.md]
---
# Capability documentation and evidence

This register distinguishes documentation coverage from implementation and runtime readiness. It is not a whole-platform completion score. A public page, contract, or historical deployment record does not establish current production readiness.

| Capability | Repository implementation and authority | Documentation coverage | Runtime evidence |
| --- | --- | --- | --- |
| Payments | Gateway facade and private payments runtime; [current ownership](../payments-platform-current.md) | Public OpenAPI, payment guides, SDK and contract checks | Live-provider, settlement, IAM, and database behavior require separate environment verification |
| Payment events | Pub/Sub delivery and outbox; [event operations](../integrations/payment-event-outbox-operations.md) | AsyncAPI and event/consumer guides | Historical records exist; delivery and replay need current consumer/provider evidence |
| Email, SMS, OTP | Independent runtimes and shared-service proxy | Authored integration guides and TypeScript contracts; downloadable OpenAPI coverage is partial | Provider delivery, approved senders, and production storage need current verification |
| Geo and Google Auth | Independent `geo`/`gauth` runtimes | Authored guides; shared OpenAPI coverage is partial | Provider credentials, OAuth configuration, and live calls remain environment-specific |
| Registry and governance | Gateway domains and management console | Internal developer/runbook guidance and selected public guides | Placement, scopes, and quota enforcement need focused tests and environment evidence |
| Documentation governance | Canonical internal bundle, guide registry, contract-derived reference | Link/metadata/source audits, contract fidelity tests, and static-export checks | The workflow produces verified artifacts; public hosting is not verified here |

## Status vocabulary

Use **implemented** when code exists with the stated focused verification; **partial** when a named part remains missing; **planned** for approved future work; and **unverified** for behavior that has not been exercised in the stated environment. Record the exact check, revision, and environment with a delivery claim. Do not upgrade an entire capability because one slice passes.

## Remaining work

- Define and validate a full machine-readable shared-service HTTP contract before presenting shared services as part of the downloadable public OpenAPI.
- Reconcile pending provider/deployment checks in the [working-document register](../superpowers/plans/README.md).
- Attach fresh deployment and provider evidence when updating historical operational records. A docs-only PR must not manufacture these results.
