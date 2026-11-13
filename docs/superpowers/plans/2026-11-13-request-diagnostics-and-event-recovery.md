---
title: Request diagnostics and payment event recovery implementation and acceptance
status: active
authority: informative
owner: platform-maintainers
audience: [engineers, reviewers, operators]
last_verified: "2026-11-14"
verification: repository
sources: [apps/gateway/src, apps/management/src, apps/payments/src, packages/contracts, scripts, tests]
---
# Request diagnostics and payment event recovery

The user approved the [operability design](../specs/2026-11-13-apicenter-operability-design.md). Local implementation is verified. This working record stays active for external acceptance; maintained behavior and procedures live in the [operator runbook](../../operations/operability-and-release-verification.md).

Implemented final-status redacted diagnostics, privileged unattributed lookup, safe payment-resource links, and tenant-scoped original-event replay.

## Local evidence

- HTTP tests verified guard-denied requests, route-template redaction, trusted token placement, generated correlation IDs, and absence of sensitive inputs.
- Four disposable PostgreSQL tests verified additive migrations, the server's default pool path, concurrent replay convergence, original identity, and unknown-outcome/other-tenant rejection.
- Management route tests denied cross-organization reads and writes, missing live confirmation, and spoofed actor/service fields.

## Remaining acceptance

- [ ] Verify runtime database roles and internal gateway-to-payment invocation in the target environment.
- [ ] Connect trusted consumer acknowledgement and dead-letter telemetry; unavailable values remain unknown.
- [ ] Exercise a selected test event replay and consumer deduplication. Reconcile uncertain external attempts before another operation.
