---
title: "APICenter Cloud Run deployment - 2026-10-12"
status: reference
authority: operational
owner: platform-operators
audience: [operators, engineers]
last_verified: "2026-10-12"
verification: runtime
sources: ["infra/gcp/cloud-build/apicenter-workspace-images.json", "supabase/migrations/20261012011500_legacy_audit_write_compatibility.sql"]
---
# APICenter Cloud Run deployment - 2026-10-12

This records the live deployment checked on 2026-10-12. Cloud resources were deployed manually to avoid writing against the unreconciled Terraform state described in [the Cloud Run ownership notes](../deployment-cloud-run.md#ownership-and-iac-boundary). The eight new workspace service definitions are saved under `infra/gcp/cloud-run/workspace/`, and the payment manifests reflect the live Cloud Run specifications. These files do not reconcile the recovered Terraform state or company Terraform.

## Project and billing

- Google Cloud project: `apicenter-alpha-20260623` (`565306324295`), region `asia-southeast1`.
- Billing is enabled on the Blaine account `01175D-7DCB52-08DB1A`.
- Artifact Registry: `asia-southeast1-docker.pkg.dev/apicenter-alpha-20260623/api-center`.
- Cloud Build `5b01c127-35f5-42ec-8180-318b5fed3e9a` succeeded and built nine images from the current APICenter checkout.
- The checkout commit was `00fce7a89be2508314fa78c152c26f6329b889a3`, matching `origin/main` when checked. Workspace changes described below were included in the build. They remain local and were not pushed.

## Cloud Run services

The management console and docs accept public HTTP requests. The gateway, shared runtimes, and payments require Cloud Run IAM authentication. The gateway uses authenticated ID tokens to call the runtimes.

| Purpose | Service | URL |
| --- | --- | --- |
| Management console, test environment | `apicenter-management-test` | <https://apicenter-management-test-mvrs6gmtgq-as.a.run.app> |
| API gateway, live | `apicenter-api-gateway-live` | <https://apicenter-api-gateway-live-mvrs6gmtgq-as.a.run.app> |
| Developer docs, live | `apicenter-developer-docs-live` | <https://apicenter-developer-docs-live-mvrs6gmtgq-as.a.run.app> |
| Email, live | `apicenter-email-live` | <https://apicenter-email-live-mvrs6gmtgq-as.a.run.app> |
| SMS, live | `apicenter-sms-live` | <https://apicenter-sms-live-mvrs6gmtgq-as.a.run.app> |
| One-time passwords, live | `apicenter-one-time-password-live` | <https://apicenter-one-time-password-live-mvrs6gmtgq-as.a.run.app> |
| Google authentication, live | `apicenter-google-authentication-live` | <https://apicenter-google-authentication-live-mvrs6gmtgq-as.a.run.app> |
| Geolocation, live | `apicenter-geolocation-live` | <https://apicenter-geolocation-live-mvrs6gmtgq-as.a.run.app> |
| Payments, test | `apicenter-payments-test` | <https://apicenter-payments-test-mvrs6gmtgq-as.a.run.app> |
| Payments, live | `apicenter-payments-live` | <https://apicenter-payments-live-mvrs6gmtgq-as.a.run.app> |

The custom domain `apicenter.itsandbox.site` is not mapped. The console's Google OAuth JavaScript origin was added to the existing OAuth client. The `/signup` page returned HTTP 200 after that change. Interactive Google sign-in was not completed as part of the deployment check.

## Database reset and current catalog

The user approved removing the old APICenter records across the application. Before the reset, the ten APICenter schemas contained 3,996 rows across catalog, audit, governance, identity, runtime, payments, and shared-service tables. A one-time atomic reset cleared those rows and reset their sequences. Supabase Auth users and migration-history tables were not included.

The reset used `TRUNCATE ... RESTART IDENTITY CASCADE` through the authenticated Supabase MCP migration operation. It was intentionally not left as an executable repository migration. The legacy audit compatibility migration remains in the repository and the live database. It lets the current audit writer work with the retained legacy audit columns without erasing those columns.

After reset and gateway restart:

- `apic_catalog.tribes` and `apic_catalog.projects` are empty.
- The gateway created the fresh `Default Organization` row on startup.
- The six deployed shared-service entries were registered with their Cloud Run URLs.
- Payment test and live have separate Cloud Run services. The shared-service registry entry currently maps the test environment. No payment operation was submitted.
- Six new audit events record the runtime registration calls.
- The Auth identities and migration ledger remain present.

## Verification performed

- All nine images built successfully in Cloud Build.
- Cloud Run reports ready revisions for all ten services.
- The private gateway readiness endpoint returned Redis `up` and six registered services. An anonymous request to the gateway returned HTTP 403.
- The management `/signup` page and developer docs root each returned HTTP 200.
- Email, SMS, OTP, Google-auth, geolocation, and payment test/live health endpoints responded successfully. PostgreSQL read-only checks connected using each shared-service database login and read its expected table.
- The management membership endpoint recognized `abtorres.it@alphaexplora.com` as a platform administrator. There are no organization memberships for this user yet.
- The management package typecheck passed earlier in the local workspace. No test suite ran during this deployment.

These checks cover startup, routing, database access, and service health. They do not send email or SMS, complete user OAuth, call Google Maps, or submit a payment.

## Follow-up

- Add Twilio credentials before enabling SMS delivery. They were absent from the existing secret bundle.
- Configure any project-specific OAuth clients in the management console after creating the organization, tribe, and project.
- Keep `apicenter.itsandbox.site` deferred until the domain is verified for the Google Cloud account.
- Reconcile the live service definitions and new Memorystore Redis instance with the recovered infrastructure ownership before the next release. No Terraform state was changed by this deployment.
- No spending budget or cap was configured for the Blaine billing account.
