---
title: Control plane operations
status: canonical
authority: operational
owner: platform-operators
audience: [operators, engineers, reviewers]
last_verified: "2026-11-20"
verification: repository
sources: [apps/gateway/src/domains/control-plane, apps/gateway/src/domains/gateway-proxy/published-apis, apps/webhooks, apps/email/src/server.ts, apps/sms/src/server.ts, apps/otp/src/server.ts, infra/gcp/cloud-run, packages/runtime/src/runtimeContext.js, supabase/migrations, scripts/control-plane, apps/management/src/features/control-plane]
---
# Control plane operations

How to deploy and configure the APICenter control plane and take a project live, as described in the [rebuild design](../superpowers/specs/2026-11-14-control-plane-rebuild-design.md). The model is in [current architecture](../architecture/current-architecture.md#control-plane). Repository checks prove the code and migrations; every step below that touches a real environment needs its own evidence.

## Deploy

1. Apply every migration in `supabase/migrations` in order. The control-plane tables are `apic_catalog.cp_*`, with row-level security per organization.
2. Confirm the gateway's `DATABASE_URL` role is a member of `api_center_app` **without** `BYPASSRLS`. Otherwise tenant isolation is not enforced by the database (application-level scoping still applies).
3. Generate runtime context keys with `node scripts/control-plane/generate-runtime-context-key.cjs`:
   - gateway: `APICENTER_RUNTIME_CONTEXT_SIGNING_KEY` (Secret Manager);
   - every runtime (email, SMS, OTP, geo, Google sign-in, payments test and live) and every published-API publisher: `APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS`.
   The payments runtime scopes records by the signed context only once it has these keys; without them it falls back to the unsigned `X-APICenter-*` headers and logs `payments_runtime_context_unverified` at startup. Deploy the gateway first (it sends the context), then give both payments services the keys.
   Rotate by adding the new public key to every runtime first, then switching the gateway's signing key, then removing the old public key after one minute.
4. Gateway settings:
   - `MANAGEMENT_GOOGLE_CLIENT_IDS`: the console's Google OAuth client IDs, so console calls act as the signed-in member.
   - `PAYMENTS_MERCHANT_ORGANIZATION_IDS`: the organizations allowed to use the payment merchant account (the bootstrap organization only).
   - `CONTROL_PLANE_WORKLOAD_AUDIENCES`: audiences accepted on Google-signed workload tokens (usually the gateway URL); empty disables workload identity.
   - `CONTROL_PLANE_TEST_DAILY_REQUESTS` (default 1,000): the test-environment budget when no plan is assigned.
   - Never set `CONTROL_PLANE_ALLOW_PRIVATE_UPSTREAMS` outside local development.
5. Existing `SHARED_SERVICE_ROUTE_<SERVICE>_<ENV>` variables route application calls; no new routes are needed.
6. Signed webhooks (`apps/webhooks`, Cloud Run `apicenter-webhooks-live`): deploy the service with `GCP_PROJECT_ID`, a dedicated runtime identity holding `roles/secretmanager.secretAccessor` only on secrets named `apicenter-webhook-*`, and no unauthenticated invokers. Create the push identity (`WEBHOOK_PUSH_SERVICE_ACCOUNT`) and grant it, once, `run.invoker` on the delivery service; grant the Pub/Sub service agent `iam.serviceAccountTokenCreator` on it, `pubsub.publisher` on the `…dead-letter` topics and `pubsub.subscriber` on the project. The gateway needs `pubsub.editor`, `iam.serviceAccountUser` on the push identity (to attach it to subscriptions) and `secretmanager.admin` conditioned on `apicenter-webhook-*` secrets (plus the project, to create them). Leave `PAYMENT_PUBSUB_IAM_ENABLED` off: webhook destinations rely on these static grants. Give the gateway `WEBHOOK_DELIVERY_URL` (the service's `run.app` URL). Each destination's URL and signing secrets live in its own secret; the database row holds only the URL.
7. Run the wiring check (`npx jest --config tests/e2e/jest-e2e.json control-plane-wiring`) against the built gateway, then the staging acceptance below.

## Console round 2

The console work merged in #201–#205 adds five migrations, four secrets and new gateway routes. An environment that already runs the control plane deploys it in this order:

1. **Secrets.** Create `apicenter-sms-admin-token` and `apicenter-otp-admin-token` (one random value each, shared by the runtime and the gateway), and `apicenter-webhooks-runtime-admin-token`. Create the login user `webhooks_runtime_login` for the `webhooks_runtime` role once migration `20261120001030` has run, and store its connection string as `apicenter-webhooks-runtime-database-url` ([shared-service database roles](shared-service-database-roles.md)). Keep the gateway's and the webhooks runtime's Secret Manager conditions for destination secrets on the prefix `apicenter-webhook-`, with the dash, so they do not also cover these `apicenter-webhooks-…` secrets. The Cloud Run manifests (`api-center.{prod,staging}.yaml`, `sms.yaml`, `otp.yaml` and the `workspace/*-live.json` exports) already reference them.
2. **Migrations, in order.**
   1. `20261120001020_console_observability`: `organization_id` and `project_id` on `apic_audit.audit_events`, environment `none` for organization-level events, a best-effort backfill and the audit log indexes. Apply it before the gateway, or every audit write fails.
   2. `20261120001021_request_diagnostics_project_index`: the request log index, built with `CREATE INDEX CONCURRENTLY` so the gateway's insert on every request is not blocked. It cannot run in a transaction. If `supabase db push` refuses it, run the file with `psql` and record it with `supabase migration repair --status applied 20261120001021`. An interrupted build leaves an invalid index that `IF NOT EXISTS` skips: drop it with `DROP INDEX CONCURRENTLY apic_runtime.request_diagnostics_project_idx` and apply the file again. `scripts/verify-control-plane-schema.ts` reports an invalid index.
   3. `20261120001030_webhook_delivery_attempts`: role `webhooks_runtime`, schema `shared_webhooks` and the append-only `webhook_deliveries` table (SELECT and INSERT; retention deletes rows after 30 days).
   4. `20261120001040_runtime_project_settings`: `shared_sms.project_senders`, `shared_otp.project_settings` and `shared_otp.otp_challenges.max_attempts`. The SMS and OTP runtimes read these tables, so apply it before redeploying them. Runtime roles have no DELETE, so a reset writes empty values.
   5. `20261120001050_control_plane_gaps`: quota policy edit and soft delete, the rejection reason and outgoing-request index on API access requests, `event_types` on event destinations, and the move of quota counters to `policy:<id>:<windowSeconds>` keys. Apply it before the gateway, which reads the new quota policy columns on every request.
   6. `20261120001060_environment_platform_suspension`: `suspended_by_platform` on `apic_catalog.cp_environments`. Apply it before the gateway, which reads the column whenever an environment's status changes.
   7. `20261120001070_test_recipients`: `apic_catalog.cp_test_recipients`, with row-level security. Apply it before the gateway, which reads it on every test-environment email, SMS and OTP send.
   8. `20261120001090_member_invites`: `invite_expires_at` and the `invited` status on `apic_catalog.organization_members`. Apply it before the gateway, which reads it at every console sign-in.
3. **Runtimes.** Redeploy email (the platform-message route for invites), SMS and OTP (the project settings and admin tokens), and webhooks (delivery history and event-type filters). The webhooks runtime starts without `DATABASE_URL` and keeps delivering; it logs `apicenter_webhook_history_disabled` and its history route answers 503 until the secret exists.
4. **Gateway** with `SMS_ADMIN_TOKEN`, `OTP_ADMIN_TOKEN` and `WEBHOOKS_ADMIN_TOKEN`. `MANAGEMENT_CONSOLE_URL` is optional; invite links default to `https://apicenter.itsandbox.site`. Grant the gateway's service account `run.invoker` on the webhooks service, which it calls with a Cloud Run identity token for history, and confirm it can publish to `apicenter.payment-events.{test,live}` for test events.
5. **Console.**

New control-plane routes, all under `/api/v1/admin/control-plane`:

| Route | Use |
| --- | --- |
| `GET`, `POST organizations`; `PUT organizations/:id`; `PUT organizations/:id/status` | Platform operators list, create, rename, suspend and reactivate organizations |
| `GET approvals`; `GET organizations/:id/approvals` | Pending live activations and API access requests (all organizations for platform operators; at most 500 live activations) |
| `PUT organizations/:id/members/:email` | Now also returns `previousRole` and the `invite` outcome. A new member is `invited` for 7 days |
| `POST organizations/:id/members/:email/invite` | Renews an unaccepted invite for 7 days and emails it again |
| `PUT organizations/:id/members/:email/status` | Suspends (`suspended`) or restores (`active`) an accepted member |
| `DELETE organizations/:id/teams/:teamId` | Deletes a team with its memberships and project roles; `409 LAST_PROJECT_ADMIN` when it is a project's only administrator |
| `PUT organizations/:id/projects/:projectId/status` | Archives (`archived`) or restores (`active`) a project; `403 SUSPENDED_BY_PLATFORM` for a project an operator suspended |
| `PUT …/environments/:env/applications/:applicationId/status` | Suspends (`suspended`) or resumes (`active`) an application |
| `GET …/environments/:env/requests`, `…/usage/series`, `…/quota-usage`; `GET organizations/:id/quota-usage` | Request log, usage series and quota meters |
| `GET organizations/:id/audit-events`; `GET audit-events` | Organization audit log; the platform-wide log for platform operators |
| `GET …/environments/:env/credentials[?expiringWithinDays=N]`; `GET …/environments/:env/grants` | Environment key and grant inventory |
| `GET …/event-destinations/:id/deliveries`; `POST …/event-destinations/:id/test-event` | Webhook delivery history; a `webhook.test` event, at most one per destination every 10 seconds on each gateway instance (`429 TEST_EVENT_COOLDOWN`) |
| `PUT …/event-destinations/:id/event-types`; `GET organizations/:id/event-types` | A signed webhook's event-type filter and the catalogue of payment event types |
| `PUT`, `DELETE organizations/:id/quota-policies/:policyId` | Edit and soft-delete a quota policy |
| `GET organizations/:id/projects/:projectId/api-access-requests/outgoing` | The API access requests a project has sent, with rejection reasons |
| `GET organizations/:id/workload-audiences` | Audiences accepted for workload identity |
| `GET organizations/:id/payments/merchant-binding` | `{ bound, reason }`, readable by any member |

The email runtime adds `POST /admin/platform-messages` (protected by `EMAIL_ADMIN_TOKEN`), which sends member invites under the platform project `apicenter-platform`.

Behavior operators should know:

- `GET …/projects`, `GET …/members` and `GET …/applications/:id/credentials` return one page: `limit` (1–200, default 100) and `cursor` select it, and `meta.nextCursor` (null at the end) continues it. `data` is still the array of items, so a caller that ignores `meta` gets the first page. Projects come oldest first and include only those the caller has a role on, unless they are an organization owner or admin.

- Suspending an organization refuses its application traffic (`ORGANIZATION_INACTIVE`) and new projects. Members can still sign in and change settings.
- Invite outcomes are audited as `control_plane.member.invite_sent` or `control_plane.member.invite_not_sent` with a reason code. An invite to the same email and organization is sent at most once in 24 hours.
- A new member is `invited` until their first verified sign-in, which accepts the invite and links their Google identity. An invite expires after 7 days; an expired invite grants nothing until it is renewed. Members who existed before migration `20261120001090` are `active`. Invited and suspended owners do not count as owners for the last-owner rule.
- Project-scoped routes answer 404 when the project is not in the organization in the path.
- An environment suspended by a platform operator stays suspended until an operator resumes it; a project admin gets `403 SUSPENDED_BY_PLATFORM`. A suspended environment, test or live, issues no keys (`409 ENVIRONMENT_SUSPENDED`).
- A live activation request is accepted only from a provisioning environment that passes readiness and has no open request (`409 LIVE_NOT_READY`, `409 ACTIVATION_ALREADY_REQUESTED`). An approval can be used for seven days; after that, request approval again.
- Changes to members, teams and project roles in one organization are serialized, so concurrent demotions cannot leave an organization without an owner.
- Test-environment email, SMS and OTP sends reach only the project's registered test recipients. For anyone else the gateway signs the runtime context with `dlv: suppress`, the runtime records the send without calling Twilio or Resend, and the response carries `X-APICenter-Test-Delivery: suppressed`. Deploy the runtimes before the gateway: an older runtime ignores the claim and would deliver.
- Removing a member, a team member or a project admin assignment answers `409 LAST_PROJECT_ADMIN` when a project would be left without an administrator and the organization has no owner or admin.
- Changing the OTP message template needs a project admin in both environments.

## Staging acceptance

- Create a project in the console, enable email, add an application, grant `email:send`, issue a test key, and send one email with SDK 3 (`APICENTER_API_KEY` set to the key). Confirm the email runtime logs an application caller and the console shows the usage.
- Confirm a request without the grant returns `ACTION_NOT_GRANTED`, a revoked key returns `CREDENTIAL_REVOKED`, and the test budget returns `QUOTA_EXCEEDED` with `Retry-After`.
- Provision live, assign a live-capable plan, create the live application and grant, request and approve `environment.activate_live` for the project, activate, and issue a live key. The console's live panel files the request (`POST …/environments/live/activation-requests`) and shows **Approve** and **Reject** to project admins (`POST …/activation-requests/:id/approve|reject`). A decision needs a signed-in person, never the shared platform credential, and the approver must differ from the requester; a request filed by an operator script is recorded as `platform-admin`, so any signed-in project admin can approve it.

## Console sign-in

The console's server looks up a signed-in person's organizations with `GET /api/v1/admin/control-plane/memberships?email=` (platform credential only, no user token). Platform operators are listed in the gateway's `PLATFORM_ADMIN_EMAILS` and act in every organization.

## Removed on 2026-11-19

The legacy model (tribes, the service registry, service tokens and refresh tokens, payment API keys, the tribe and external proxies, registry governance, Kafka, Vault and Descope settings) is gone, with SDK 3.0 and payment event contract 2.0. Existing payment, email, SMS and OTP records keep their owner through `cp_resource_owner_mappings`. Drop the leftover legacy tables in a later migration once no record still needs that mapping.
