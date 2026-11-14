---
title: Readiness and live provisioning implementation and acceptance
status: active
authority: informative
owner: platform-maintainers
audience: [engineers, reviewers, operators]
last_verified: "2026-11-14"
verification: repository
sources: [apps/gateway/src, apps/management/src, apps/payments/src, packages/contracts, scripts, tests]
---
# Readiness and live provisioning

The user approved the [operability design](../specs/2026-11-13-apicenter-operability-design.md). Local implementation is verified. This working record stays active for external acceptance; maintained behavior and procedures live in the [operator runbook](../../operations/operability-and-release-verification.md).

Implemented durable verification reports, queued/claimed runs, exact approval and effective subscription checks, observed runtime identity, issuance receipts, live confirmation, and separate subscription recovery.

## Local evidence

- Disposable PostgreSQL verified issuance receipts, concurrent rotation, immutable reports, uncertain-run blocking, and reconciliation.
- Gateway unit tests and boundary checks pass. Registry presence cannot supply a passed smoke result.
- Approval records have no expiry field; no synthetic expiry policy was introduced.

## Remaining acceptance

- [ ] Apply the nine additive migrations and verify application roles in the target environment.
- [ ] Configure observed Cloud Run targets, release SHA, and dedicated runner assignments.
- [ ] Exercise approved service/payment live-access approval and subscription provisioning against the deployed environment.
