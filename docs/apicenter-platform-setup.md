# APICenter Platform Setup

This is the current operator guide for APICenter. The active production runtime is
Cloud Run. APICenter mediates payment provider calls and stores project ownership,
reconciliation, webhook receipt, and event-delivery records. PayMongo remains the
source of truth for provider-backed payment resources; AlphaCI uses the SDK and
projects lifecycle events into its local database.

## Repository Ownership

| Area | Code owner |
| --- | --- |
| Gateway, auth, registry, policy, quotas | `apps/gateway` |
| Shared provider runtimes (email, SMS, OTP, Google Auth, geo) | `apps/email`, `apps/sms`, `apps/otp`, `apps/gauth`, `apps/geo` |
| PayMongo credentials and provider calls; APICenter ownership/reconciliation records and outbox | `apps/payments` |
| Management console and provisioning | `apps/management` |
| Public contracts and TypeScript SDK | `packages/contracts`, `packages/sdk` |
| AlphaCI-specific entitlement and local ledger projection | `alphaci-be` |

`api-shared` and the former standalone management repository are migration history,
not active feature targets.

## Runtime Topology

Synchronous requests:

```text
consumer service -> @alpha-explora/apicenter-sdk -> Cloud Run gateway
  -> private payments runtime or governed tribe/shared-service route
```

Payment events:

```text
APICenter payment outbox -> Google Pub/Sub test/live topic
  -> OIDC-authenticated Cloud Run push subscription -> AlphaCI inbox/projector
```

Payment lifecycle eventing does not use Confluent Cloud. The general Kafka modules
remain compatibility infrastructure for non-payment platform events; no new payment
integration should depend on them.

## Cloud Run Services

The gateway and all shared runtimes are independently deployable. Use the checked-in
manifests under infra/gcp/cloud-run/ and the Pub/Sub topology under
infra/gcp/pubsub/. Payment test/live runtimes use separate services, databases, internal
tokens, topics, and service accounts. Email, SMS, OTP, Google Auth, and geo each use
separate Cloud Run services, provider bindings, and runtime guardrails.

Required gateway settings include:

- `APICENTER_PAYMENTS_URL` or the environment-specific shared payment route.
- `APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST` and `_LIVE`.
- `APICENTER_PAYMENT_EVENTS_TOPIC_TEST` and `_LIVE` for event publishing.
- Redis settings for distributed rate limits and idempotency.

The payment runtime requires PayMongo credentials only in its own Secret Manager
binding. Never expose provider credentials to a consumer service or AlphaCI.

## Provisioning

1. Apply the APICenter gateway and shared-runtime Cloud Run manifests for the target environment.
2. Apply the matching Pub/Sub topic/subscription/dead-letter manifests.
3. Grant the payment runtime publisher role on the topic.
4. Grant the AlphaCI receiver service account permission to receive push deliveries.
5. Configure the gateway's environment-specific internal route and token secrets.
6. Run the local contract, typecheck, SDK, and shared-runtime smoke tests before live smoke.

The management console provisions consumer registrations and scoped API keys. Keep
payment scopes least-privilege; immediate subscription cancellation is a separate
scope from cancel-at-period-end.

## Local Verification

```powershell
npm ci
npm run typecheck
npm run check:monorepo
npm run check:boundaries:test
npm run contracts:validate
npm run check:contracts
npm run contracts:test
npm run sdk:build
npm run docs:build
```

For the payment-specific API and event contract, see
`docs/payments-platform-current.md`, `contracts/public/apicenter.openapi.yaml`, and
`contracts/public/apicenter.asyncapi.yaml`.
