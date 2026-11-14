---
title: Guided go-live and credential lifecycle implementation and acceptance
status: active
authority: informative
owner: platform-maintainers
audience: [engineers, reviewers, operators]
last_verified: "2026-11-14"
verification: repository
sources: [apps/gateway/src, apps/management/src, apps/payments/src, packages/contracts, scripts, tests]
---
# Guided go-live and credential lifecycle

The user approved the [operability design](../specs/2026-11-13-apicenter-operability-design.md). Local implementation is verified. This working record stays active for external acceptance; maintained behavior and procedures live in the [operator runbook](../../operations/operability-and-release-verification.md).

Implemented the Governance go-live panel, payment key inventory/targeted revocation, and service-secret start/verify/revoke-old lifecycle under registry ownership.

## Local evidence

- Disposable PostgreSQL and a Secret Manager boundary fixture verified replacement authentication before old-secret removal.
- Management's 523-test suite passes; nine new route authorization cases also pass.
- A real headless browser verified live confirmation, one queued run, targeted key revocation, mobile layout, and the Audit empty state through Management routes.

## Remaining acceptance

- [ ] Configure Secret Manager reader/version-writer permissions for the gateway identity.
- [ ] Perform a controlled rotation in the target environment, including multi-instance cache propagation.
- [ ] Complete the consumer backend secret installation and production deployment handoff.
