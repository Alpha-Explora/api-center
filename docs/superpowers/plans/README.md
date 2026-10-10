# Working-document register

Plans record execution scope and pending checks. Use [current architecture](../../architecture/current-architecture.md), [payment ownership](../../payments-platform-current.md), contracts, code, and maintained runbooks for implemented behavior. Old checked boxes and deployment snapshots are not fresh verification.

| Document | Status and remaining evidence | Durable authority |
| --- | --- | --- |
| [Shared-services migration](2026-07-28-apicenter-shared-services.md) | Partially delivered in the recorded checklist; authenticated consumer/provider smoke checks remain pending in that record | Current architecture, runtime apps, shared-service guides, deployment manifests |
| [Codebase structure cleanup](2026-07-28-apicenter-codebase-cleanup.md) | Working scope; unchecked stages require code and test reconciliation before closure | Gateway domain roots and boundary checks |
| [Review remediation](2026-10-01-apicenter-review-remediation.md) | Repository fixes recorded; clean-install and local Docker checks remain unchecked in the old record | Public contracts, runtime code, runbooks, CI |
| [Secret Manager cleanup](2026-05-22-secret-manager-migration-cleanup.md) | Historical GKE-era reference; do not execute its commands against the current platform without a fresh inventory | Current Cloud Run manifests, platform setup, current operator inventory |

## Working specifications

- [Shared-services design](../specs/2026-07-28-apicenter-shared-services-design.md)
- [Review remediation design](../specs/2026-10-01-apicenter-review-remediation-design.md)

Completed work is promoted into maintained concepts, ADRs, and runbooks. Remove the completed execution artifact and its pointers after recording the remaining evidence. Git history preserves the original plan. No incomplete plan is marked complete by this docs update.
