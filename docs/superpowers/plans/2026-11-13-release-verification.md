---
title: Repeatable release verification implementation and acceptance
status: active
authority: informative
owner: platform-maintainers
audience: [engineers, reviewers, operators]
last_verified: "2026-11-14"
verification: repository
sources: [apps/gateway/src, apps/management/src, apps/payments/src, packages/contracts, scripts, tests]
---
# Repeatable release verification

The user approved the [operability design](../specs/2026-11-13-apicenter-operability-design.md). Local implementation is verified. This working record stays active for external acceptance; maintained behavior and procedures live in the [operator runbook](../../operations/operability-and-release-verification.md).

Implemented versioned sanitized artifacts, repository/deployed/all phases, observed deployment revisions, protected fixtures, durable claim gating, and manual CI integration.

## Local evidence

- Nine release-runner cases pass, including a real CLI blocked-artifact/overwrite check and zero provider calls without a durable claim.
- Full monorepo build passes across 11 workspaces; root typecheck passes across 14 workspaces.
- Full gateway suite passes with 774 tests and four explicit database-gated skips; the new HTTP/database/evidence focused set passes 12 tests with its disposable database enabled.
- Review findings about pool creation, artifact snapshot ordering, unclaimed provider effects, and JWT actor attribution were fixed and re-checked.

## Remaining acceptance

- [ ] Configure protected GitHub environment secrets, Google identity federation, deployment targets, and runner tokens.
- [ ] Run clean-commit acceptance against the selected deployed revisions and protected provider fixtures.
- [ ] Supply independently trusted consumer acknowledgement for event_delivery. The runner currently leaves this check blocked.
- [ ] No deployment, production migration, package publication, commit, push, or live provider operation was performed in this implementation.
