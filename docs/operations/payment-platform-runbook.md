---
title: "APICenter Payment Platform Runbook"
status: canonical
authority: operational
owner: platform-operators
audience: [operators, engineers]
last_verified: "unverified"
verification: unverified
sources: ["packages/contracts/src/index.ts","apps/payments/src/server.ts"]
---
# APICenter Payment Platform Runbook

This runbook is for the APICenter payment facade, the private payments runtime,
Google Pub/Sub lifecycle delivery, and AlphaCI's local projection. APICenter is
the only public payment API and owns the provider credential boundary. Consumer
services use the SDK and never receive PayMongo credentials.

## 1. Release Inputs

Record these values in the release evidence artifact before changing a gate:

| Value | Test | Live |
| --- | --- | --- |
| APICenter base URL | `APICENTER_BASE_URL` | production URL |
| Payment environment | `test` | `live` |
| Consumer service ID | registered service ID | registered service ID |
| Pub/Sub topic | `APICENTER_PAYMENT_EVENTS_TOPIC_TEST` | `APICENTER_PAYMENT_EVENTS_TOPIC_LIVE` |
| AlphaCI event endpoint | Cloud Run test URL | Cloud Run live URL |
| AlphaCI cutover gate | `APICENTER_PAYMENTS_ENABLED=false` until evidence passes | enable only for approved cohort |

Keep API keys, internal tokens, OIDC service-account credentials, and provider
secrets in Secret Manager or the deployment secret store. Do not put them in
the SDK, browser bundle, Markdown, or a committed `.env` file.

## 2. API-Key Creation And Rotation

1. In APICenter Management, create or rotate a consumer key for the exact
   `ownerTribeId`, `consumerServiceId`, and environment.
2. Grant only `payments:read` for status-only consumers, or
   `payments:read,payments:write` for checkout and lifecycle commands.
3. Store the key in the consumer's runtime secret manager and deploy a new
   revision. Keep the old key active during the overlap window.
4. Run the test smoke, then revoke the old key and record the key ID, actor,
   time, environment, and smoke evidence ID.

The API key authenticates the consumer to APICenter. It is not a PayMongo key.

## 3. Pub/Sub And Cloud Run Validation

For each environment verify:

```bash
npm run gcp:provision-payment-events
```

The consumer subscription must have:

- filter `attributes.consumerServiceId = "<consumer-service-id>"`;
- OIDC push authentication using the provisioned delivery service account;
- audience equal to the AlphaCI event endpoint;
- a dead-letter topic and subscription;
- `maxDeliveryAttempts=20` and an acknowledgement deadline of at least 30s.

The delivery service account needs `roles/run.invoker` on the AlphaCI Cloud Run
service. The payments runtime service account needs Pub/Sub publisher access on
the environment topic. Confirm both IAM bindings and the Cloud Run revision
before enabling delivery.

## 4. Smoke And Release Verification

Install dependencies and run the deterministic integration smoke:

```bash
npm ci
npm run test:integration
```

For a test or live endpoint, provide the SDK and harness configuration:

```bash
$env:APICENTER_BASE_URL='https://api-center.example'
$env:APICENTER_API_KEY='stored-consumer-key'
$env:APICENTER_TRIBE_ID='tribe-alpha'
$env:APICENTER_CONSUMER_SERVICE_ID='alphaci-backend'
$env:PAYMENT_SMOKE_EVENT_INJECTOR_URL='https://alphaci-events.example/internal/smoke'
$env:PAYMENT_SMOKE_PUBSUB_OBSERVER_URL='https://ops.example/pubsub/events'
$env:PAYMENT_SMOKE_PROJECTION_URL='https://ops.example/alphaci/projection'
$env:PAYMENT_SMOKE_ENTITLEMENT_URL='https://ops.example/alphaci/entitlement'
npx ts-node scripts/smoke/payment-platform-smoke.ts
```

The smoke must show the same checkout ID on the second request, one canonical
`payment.checkout.paid` event, an active AlphaCI entitlement, a stable
projection after a stale duplicate, and no `providerData`, PayMongo IDs, or
secret fields in the canonical event.

## 5. Reconciliation And Import

Run the AlphaCI commands from `alphaci-be` with the database migration applied:

```bash
npm run billing:import-apicenter
npm run billing:reconcile-apicenter
```

Expected import output has zero failed records. Terminal history is skipped;
active subscriptions, pending resources, reusable payment-method references,
and payments still inside the refund window are imported with deterministic
references. Reconciliation is read-only and must not issue a provider mutation.

Investigate any unmatched non-terminal record, unprocessed inbox event, dead
letter, projection lag over 15 minutes, or unexplained version mismatch before
continuing rollout.

## 6. Cutover And Rollback

1. Start with `APICENTER_PAYMENTS_ENABLED=false`. This blocks new AlphaCI
   payment commands and leaves only historical reads available.
2. Complete test smoke and one approved live smoke. Confirm import and
   reconciliation counts, Pub/Sub delivery, AlphaCI projection, and refund and
   subscription behavior.
3. Enable the gate for the approved consumer cohort, then monitor delivery
   failures, dead letters, projection lag, and payment mismatches.
4. Expand only after the observation window is clean.

Rollback is a configuration change only:

```text
APICENTER_PAYMENTS_ENABLED=false
```

Do not re-enable a direct PayMongo command path and do not replay a provider
mutation as part of rollback. Leave already committed APICenter events and
AlphaCI projections intact.

## 7. PayMongo Secret Removal

After cutover evidence is accepted, verify that AlphaCI no longer loads an
active PayMongo secret and that the PayMongo webhook route is not deployed.
Remove the AlphaCI secret-manager bindings only after the evidence artifact is
approved. Retain legacy provider columns and historical identifiers for display
and reconciliation; they are not command credentials.

## 8. Incident Triage

- **401/403 delivery:** check OIDC audience, service-account subject, and Cloud
  Run invoker binding before replaying anything.
- **Dead letter:** inspect the canonical envelope and AlphaCI inbox error,
  correct the consumer, then replay the same event ID once through the
  controlled replay path.
- **Projection mismatch:** run reconciliation; do not create a second payment
  or refund to repair local state.
- **Duplicate event:** verify event ID and aggregate version. The projector
  must acknowledge a stale duplicate without changing entitlement.
