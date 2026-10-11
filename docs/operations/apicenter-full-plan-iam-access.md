---
title: "APICenter Full-Plan IAM Access"
status: canonical
authority: operational
owner: platform-operators
audience: [operators, engineers]
last_verified: "unverified"
verification: unverified
sources: ["infra/gcp"]
---
# APICenter Full-Plan IAM Access

**Principal:** `admin@alphaexplora.com`
**Project:** `apicenter-alpha-20260623`
**Granted:** 2026-07-28
**Retention:** Keep these bindings until Tasks 0-10 of the APICenter payment-platform plan are complete. Remove them only after the final release and operations handoff review.

The approved project-level role set is:

- `roles/resourcemanager.projectIamAdmin`
- `roles/serviceusage.serviceUsageAdmin`
- `roles/run.admin`
- `roles/run.sourceDeveloper`
- `roles/iam.serviceAccountAdmin`
- `roles/iam.serviceAccountUser`
- `roles/pubsub.admin`
- `roles/monitoring.admin`
- `roles/secretmanager.admin`
- `roles/artifactregistry.admin`
- `roles/cloudbuild.builds.editor`
- `roles/logging.viewer`

This set intentionally excludes `roles/owner` and `roles/editor`. The AlphaCI
consumer project remains separately owned; the delivery provisioner uses
`--consumer-project alphaci-20260629` to grant the APICenter delivery service
account `roles/run.invoker` only on the registered AlphaCI receiving service.

## Removal Gate

Before removing the temporary access, verify:

1. Tasks 0-10 are complete and the release is deployed.
2. Cloud Build, Cloud Run, Pub/Sub, Secret Manager, Artifact Registry, and Monitoring operations use service identities rather than this human account.
3. The final IAM policy snapshot is archived with the operations handoff.
4. No active migration, rollback, replay, or incident requires this access.