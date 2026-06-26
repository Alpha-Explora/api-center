# APICenter Plan Index

This index keeps historical implementation evidence without making every old
plan look active. Status values are:

```text
active, completed, superseded, historical
```

## Tracked Plans

| Status     | Plan                                                                | Current source of truth                                                               |
| ---------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| completed  | `2026-05-15-apicenter-control-plane-database.md`                    | `docs/developer/registry-persistence-runbook.md` for registry cutover behavior.       |
| historical | `archive/2026-05-16-gcp-project-redeploy-migration.md`              | `README.md` and `infra/gcp/gke/README.md` for current runtime deployment notes.             |
| historical | `archive/2026-05-16-hybrid-paymongo-payment-lifecycle.md`           | `api-shared-services/docs/consumer-runbook.md` for SDK consumption.                   |
| historical | `archive/2026-05-16-multi-merchant-paymongo-routing.md`             | Shared-services payment docs and provider manifests.                                  |
| completed  | `2026-05-16-payments-table-first-recovery.md`                       | Payment persistence migrations and shared-services payment tests.                     |
| completed  | `2026-05-16-paymongo-webhook-payments-fix.md`                       | Shared-services payment webhook implementation and tests.                             |
| historical | `archive/2026-05-16-supabase-live-test-database-cutover.md`         | Environment split docs and registry persistence runbook.                              |
| historical | `archive/2026-05-16-supabase-prod-database-migration.md`            | Supabase migrations and deployment runbooks.                                          |
| completed  | `2026-05-16-test-live-environment-split.md`                         | Environment-specific runtime docs and Secret Manager setup.                           |
| historical | `archive/2026-05-16-unfinished-platform-work.md`                    | Newer platform/data-pipeline plans supersede the remaining work.                      |
| superseded | `archive/2026-05-17-payment-sdk-production-rollout-next-phases.md`  | `api-shared-services/docs/consumer-runbook.md`.                                       |
| historical | `archive/2026-05-17-stripe-like-paymongo-checkout-subscriptions.md` | Shared-services payment provider docs.                                                |
| completed  | `2026-05-19-tribe-boundary-events-sdk.md`                           | `docs/data-pipeline/tribe-event-contract.md` and SDK tests.                           |
| completed  | `2026-05-19-tribe-data-pipeline-ownership.md`                       | `docs/data-pipeline/README.md` and data-pipeline runbooks.                            |
| completed  | `2026-05-20-actual-data-pipeline-implementation.md`                 | `docs/data-pipeline/actual-pipeline-runbook.md`.                                      |
| completed  | `2026-05-20-apicenter-tribe-registration-rollout-phased-plan.md`    | Management topic/provisioning workflows and pipeline onboarding docs.                 |
| completed  | `2026-05-20-athena-results-separation-cleanup.md`                   | `docs/data-pipeline/athena-results-runbook.md`.                                       |
| completed  | `2026-05-20-data-pipeline-pilot-and-management-health.md`           | Management pipeline health panel and `docs/data-pipeline/actual-pipeline-runbook.md`. |

## Current And Follow-Up Plans

| Status     | Plan                                                                | Current source of truth                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| superseded | `archive/2026-05-20-apicenter-system-cleanup-improvement-plan.md`   | `../../../../docs/superpowers/plans/2026-06-19-apic-codebase-improvement-master-plan.md`.                                                                                                                    |
| completed  | `2026-05-25-apicenter-platform-wide-governance-and-tribe-quotas.md` | Cross-platform APICenter quota/governance implementation now lives in API Center runtime, Management quota operations, SDK contracts, and rollout docs. |
| completed  | `2026-05-25-apicenter-code-review-remediation.md`                   | Review remediation plan for static Management pages, fabricated promotion evidence, emergency control safety, scorecard metrics, compliance exports, Control Tower lint, and line-ending cleanup.           |
| completed  | `2026-05-25-apicenter-hardening-and-product-improvements.md`        | Follow-up hardening plan for fail-closed governance enforcement, lint/CI cleanup, deployed quota smoke, governance readiness, audit exports, cost-aware quotas, and tribe self-service requests.             |
| completed  | `2026-05-25-apicenter-operational-trust-and-productization.md`      | Next-wave product plan for governance drift detection, runtime dependency mapping, promotion evidence bundles, emergency controls, API marketplace, forecasting, deprecations, compliance, and scorecards.  |
| historical | `archive/2026-05-20-control-tower-cicd-s3-telemetry.md`             | Control Tower/APICenter telemetry plan; not part of the current API Center runtime implementation slice.                                                                                                     |
| completed  | `2026-05-20-apicenter-total-data-pipeline-phased-plan.md`           | Full phased plan for test/prod APICenter data pipeline, central governance, live management health, tribe Silver/Gold, and decision signals.                                                                 |
| completed  | `2026-05-21-phase-9-blocker-fix-plan.md`                            | Blocker remediation plan for live Athena runtime, Athena cost telemetry, and durable feedback actions.                                                                                                       |
| completed  | Enterprise Supabase control-plane migration                          | Completed and cleaned up after live Supabase cutover. Current state lives in `../../database-control-plane.md` and `../../developer/registry-persistence-runbook.md`.                                      |
| active     | `2026-05-22-secret-manager-migration-cleanup.md`                    | Still open because completion requires GCP Secret Manager/GKE inventory, version-disable evidence, and old-project retention decisions outside the merged code. |
| completed  | `2026-06-18-tribe-multi-environment-registry.md`                   | Multi-environment registry, routing, Management UI, topic helpers, deprovisioning behavior, and docs landed through the merged optimization work. |
| active     | `2026-06-22-aws-data-pipeline-shutdown-migration.md`               | Operational AWS/Confluent/S3 shutdown and migration plan; active until a replacement target is chosen, data is copied/validated, and old AWS resources are removed or archived. |
| superseded | `archive/2026-06-18-apicenter-code-optimization.md`                | `../../../../docs/superpowers/plans/2026-06-19-apic-codebase-improvement-master-plan.md`.                                                                                                                    |

## Active Plan Audit

`2026-05-22-secret-manager-migration-cleanup.md` remains active because it is an
operational cloud cleanup plan, not a code implementation plan, and the plan
itself says to mark it completed only after Secret Manager/GKE evidence is
recorded.

`2026-06-22-aws-data-pipeline-shutdown-migration.md` remains active until the
replacement analytics target is chosen, S3/Glue/IAM evidence is exported, data
is copied and validated, Confluent writes are paused or repointed, and old AWS
resources are removed or intentionally archived.
