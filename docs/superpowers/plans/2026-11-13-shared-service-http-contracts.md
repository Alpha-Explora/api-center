---
title: Shared-service HTTP contracts implementation and acceptance
status: active
authority: informative
owner: platform-maintainers
audience: [engineers, reviewers, operators]
last_verified: "2026-11-14"
verification: repository
sources: [apps/gateway/src, apps/management/src, apps/payments/src, packages/contracts, scripts, tests]
---
# Shared-service HTTP contracts

The user approved the [operability design](../specs/2026-11-13-apicenter-operability-design.md). Local implementation is verified. This working record stays active for external acceptance; maintained behavior and procedures live in the [operator runbook](../../operations/operability-and-release-verification.md).

Published 14 supported shared-service SDK operations and four identity operations in the existing consumer OpenAPI. Updated pinned JSON, references, snippets, and credential-aware documentation.

## Local evidence

- Sixteen new contract fidelity cases pass, including YAML/JSON equality, operation inventory, runtime scopes, bearer-only shared authentication, idempotency requirements, statuses, and private-route exclusion.
- Public contract validation and SDK contract checks pass.
- Full monorepo build, seven exported-documentation tests, and docs typecheck pass.

## Remaining acceptance

- [ ] Compare selected authenticated operations with the deployed provider runtimes before production acceptance.
- [ ] Publish the verified documentation and contract artifacts through the normal release process.
