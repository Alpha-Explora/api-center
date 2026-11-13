---
title: "APICenter cloud review - 2026-10-11"
status: reference
authority: reference
owner: platform-operators
audience: [operators, engineers]
last_verified: "2026-10-11"
verification: repository
sources: ["infra/gcp","Dockerfile","Dockerfile.shared-service"]
---
# APICenter live cloud status — 2026-10-11

The cloud observations below are a dated review record and were not refreshed during repository synchronization. The verification metadata covers repository reconciliation only.

This is a point-in-time operational record from the authorized GCP review. It supplements the dated rollout history in [deployment-cloud-run.md](../deployment-cloud-run.md); it is not an IaC source of truth.

## Project and billing

`apicenter-alpha-20260623` (`565306324295`) remains under the `10-products/apicenter` folder. After finance confirmed Blaine funding for APICenter, the project was linked to `billingAccounts/01175D-7DCB52-08DB1A`. Live Cloud Billing reads confirm `billingEnabled=true`. The temporary project-level `roles/billing.projectManager` binding used for the link was removed, and post-change IAM checks confirm it is absent. The product repo does not yet own this billing association in Terraform.

Billing restoration allows billable project services to operate and charge Blaine. No spending cap or budget amount was configured. Do not treat the billing change as confirmation that APICenter is ready for a production release.

## Cloud Run readiness

GCP lists 16 services. Twelve latest revisions report ready. Four newer revisions report failures, while traffic remains pinned 100% to each service's older ready revision.

| Service | Latest created revision | Latest ready revision receiving 100% traffic | Latest revision result |
| --- | --- | --- | --- |
| `gauth` | `gauth-00009-zq6` | `gauth-00008-6xp` | `SecretsAccessCheckFailed` for `apicenter-shared-google-tenant-clients-prod` |
| `geo` | `geo-00009-zhm` | `geo-00008-xff` | `SecretsAccessCheckFailed` for `apicenter-shared-google-maps-api-key-prod` |
| `otp` | `otp-00009-ht7` | `otp-00008-hx4` | `HealthCheckContainerError`; scoped log query returned no entries |
| `sms` | `sms-00009-8c9` | `sms-00008-dvg` | `HealthCheckContainerError`; scoped log query returned no entries |

Secret IAM policies contain unconditional `roles/secretmanager.secretAccessor` bindings for the `gauth` and `geo` runtime service accounts. A fresh metadata-only version-list check returned zero versions for all five names referenced by those failing revisions: `apicenter-shared-google-tenant-clients-prod`, `apicenter-shared-google-client-id-prod`, `apicenter-shared-google-client-secret-prod`, `apicenter-shared-google-redirect-uri-prod`, and `apicenter-shared-google-maps-api-key-prod`. The runtime owners need to restore the intended secret versions or correct the service configuration; do not broaden IAM based on the service message alone. No secret payload was accessed. No service, secret, IAM or deployment change was made during this check.

The `api-center` gateway has latest ready revision `api-center-00011-lbt`, but 100% of traffic remains on `api-center-00010-hdj`. Review the release and smoke evidence before moving traffic.

## Current infrastructure writer evidence

The company state bucket contains `apicenter-product-runtime/default.tfstate`, last updated 2026-08-11. Its state is version 4, serial 24, with 61 managed resources and two data records. Its module addresses include the gateway, staging and operational services, service identities and secret grants, Pub/Sub messaging, registry, monitoring, and payments. Resource names and state metadata were inspected in memory; state values were not printed or saved.

The APICenter repository's reachable Git history has no Terraform files. Connected GitHub code search did not find the distinctive state-module names. APICenter has zero Cloud Build triggers. Two inspected recent builds used source tarballs uploaded to the project's Cloud Build bucket and the `apicenter-cloudbuild-deployer` service account; the upstream source commit was not identified. Checked-in Cloud Build configs use `gcloud run services replace`, while the state contains Terraform Cloud Run service resources. The service deployer has broad project `roles/run.admin`. This creates overlapping service writers until the exact source and release owner are recovered.

Do not create a replacement Terraform root or import live services into a second state. Recover the root source, exact state coordinates, and manual build caller; then assign static service configuration, image promotion, service IAM, secret grants, and application-created resources to one writer each. Move staging only after the non-production project, secret versions, event routes, and smoke checks are verified.

## Local container image verification

On 2026-10-11, local Docker builds succeeded for both gateway images, payments, and all five shared-runtime images. Every image resolved its app-declared runtime dependencies from its workspace. A second pass rebuilt both gateway images with `--no-cache`; `prisma generate`, both Nest builds, and Prisma 7.8.0 schema-engine checks succeeded. Each fresh gateway image resolved its two declared runtime dependencies and returned HTTP 200 from `/api/v1/health/live`; payments, email, SMS, geo, gauth, and OTP each returned HTTP 200 from `/health` in a local container. The gateway `ProjectOverviewModule` also imports `AuthModule`, resolving its `ScopedAdminGuard` startup dependency.

The gateway smoke checks used `NODE_ENV=development` and local Redis fallbacks. They verify packaged dependencies, process startup, and liveness; they do not verify production configuration, database or Redis readiness, secrets, or GCP. No image was pushed and no Cloud Run service was changed. Adding the generated Next.js caches and root Turborepo cache to `.dockerignore` reduced a representative Docker context from about 614 MB to 389 KB. Fresh no-cache gateway builds audited 67 dependencies with advisories (2 critical) before pruning and 60 (1 critical) in the pruned image. npm 11.19 warned about six dependency lifecycle scripts without explicit approvals during install; five remained after pruning. Prisma client generation and schema-engine presence passed without broadening those approvals. Review the [npm install-script approval policy](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts) and verify database-backed runtime behavior before production.
