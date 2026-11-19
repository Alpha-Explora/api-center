---
title: Control plane operations
status: canonical
authority: operational
owner: platform-operators
audience: [operators, engineers, reviewers]
last_verified: "2026-11-19"
verification: repository
sources: [apps/gateway/src/domains/control-plane, apps/gateway/src/domains/gateway-proxy/published-apis, apps/webhooks, packages/runtime/src/runtimeContext.js, supabase/migrations, scripts/control-plane, apps/management/src/features/control-plane]
---
# Control plane operations

How to deploy and configure the APICenter control plane and take a project live, as described in the [rebuild design](../superpowers/specs/2026-11-14-control-plane-rebuild-design.md). The model is in [current architecture](../architecture/current-architecture.md#control-plane). Repository checks prove the code and migrations; every step below that touches a real environment needs its own evidence.

## Deploy

1. Apply every migration in `supabase/migrations` in order. The control-plane tables are `apic_catalog.cp_*`, with row-level security per organization.
2. Confirm the gateway's `DATABASE_URL` role is a member of `api_center_app` **without** `BYPASSRLS`. Otherwise tenant isolation is not enforced by the database (application-level scoping still applies).
3. Generate runtime context keys with `node scripts/control-plane/generate-runtime-context-key.cjs`:
   - gateway: `APICENTER_RUNTIME_CONTEXT_SIGNING_KEY` (Secret Manager);
   - every runtime (email, SMS, OTP, geo, Google sign-in) and every published-API publisher: `APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS`.
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

## Staging acceptance

- Create a project in the console, enable email, add an application, grant `email:send`, issue a test key, and send one email with SDK 3 (`APICENTER_API_KEY` set to the key). Confirm the email runtime logs an application caller and the console shows the usage.
- Confirm a request without the grant returns `ACTION_NOT_GRANTED`, a revoked key returns `CREDENTIAL_REVOKED`, and the test budget returns `QUOTA_EXCEEDED` with `Retry-After`.
- Provision live, assign a live-capable plan, create the live application and grant, request and approve `environment.activate_live` for the project, activate, and issue a live key. The console's live panel files the request (`POST …/environments/live/activation-requests`) and shows **Approve** and **Reject** to project admins (`POST …/activation-requests/:id/approve|reject`). A decision needs a signed-in person, never the shared platform credential, and the approver must differ from the requester; a request filed by an operator script is recorded as `platform-admin`, so any signed-in project admin can approve it.

## Console sign-in

The console's server looks up a signed-in person's organizations with `GET /api/v1/admin/control-plane/memberships?email=` (platform credential only, no user token). Platform operators are listed in the gateway's `PLATFORM_ADMIN_EMAILS` and act in every organization.

## Removed on 2026-11-19

The legacy model (tribes, the service registry, service tokens and refresh tokens, payment API keys, the tribe and external proxies, registry governance, Kafka, Vault and Descope settings) is gone, with SDK 3.0 and payment event contract 2.0. Existing payment, email, SMS and OTP records keep their owner through `cp_resource_owner_mappings`. Drop the leftover legacy tables in a later migration once no record still needs that mapping.
