# Working-document register

Plans record execution scope and pending checks. Use [current architecture](../../architecture/current-architecture.md), [payment ownership](../../payments-platform-current.md), contracts, code, and maintained runbooks for implemented behavior. Old checked boxes and deployment snapshots are not fresh verification.

| Document | Status and remaining evidence | Durable authority |
| --- | --- | --- |
| [APICenter hosted domain rollout](2026-10-12-apicenter-domain-rollout.md) | DNS, HTTPS certificate, gateway access, Management and docs deployment, docs redirect fix and OAuth origin confirmed. Interactive sign-in and consumer/provider acceptance remain pending | Hosted access runbook, dated domain rollout record, gateway authentication and deployment manifests |
| [Shared-services migration](2026-07-28-apicenter-shared-services.md) | Partially delivered in the recorded checklist; authenticated consumer/provider smoke checks remain pending in that record | Current architecture, runtime apps, shared-service guides, deployment manifests |
| [Codebase structure cleanup](2026-07-28-apicenter-codebase-cleanup.md) | Working scope; unchecked stages require code and test reconciliation before closure | Gateway domain roots and boundary checks |
| [Secret Manager cleanup](2026-05-22-secret-manager-migration-cleanup.md) | Historical GKE-era reference; do not execute its commands against the current platform without a fresh inventory | Current Cloud Run manifests, platform setup, current operator inventory |
| [APICenter SDK overhaul](2026-10-12-apicenter-sdk-overhaul.md) | Implementation and local validation complete; publication is handled as a separately authorized release | Approved SDK redesign specification, gateway routes, service manifests, and contracts |

## Working specifications

- [APICenter domain layout and consumer access](../specs/2026-10-12-apicenter-domain-layout-design.md), native execution approved; remaining acceptance checks are in the dated domain rollout record.
- [APICenter SDK redesign](../specs/2026-10-12-apicenter-sdk-overhaul-design.md)
- [Shared-services design](../specs/2026-07-28-apicenter-shared-services-design.md)
- [Review remediation design](../specs/2026-10-01-apicenter-review-remediation-design.md)

Completed work is promoted into maintained concepts, ADRs, and runbooks. Remove the completed execution artifact and its pointers after recording the remaining evidence. Git history preserves the original plan. No incomplete plan is marked complete by this docs update.

The completed 2026-10-01 review-remediation plan was retired after its local image and liveness checks. Its evidence and remaining production checks are recorded in [the 2026-10-11 cloud review](../../operations/cloud-live-status-2026-10-11.md).
