# APICenter Platform Setup

This is the current operator guide for APICenter. The active production runtime is
Cloud Run. Payment provider calls and payment state are owned by APICenter; AlphaCI
uses the SDK and projects lifecycle events into its local database.

## Repository Ownership

| Area | Source of truth |
| --- | --- |
| Gateway, auth, registry, policy, quotas | `apps/gateway` |
| PayMongo credentials, provider calls, canonical payment state, outbox | `apps/payments` |
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

The gateway and payment runtimes are independently deployable. Use the checked-in
manifests under `infra/gcp/cloud-run/` and the Pub/Sub topology under
`infra/gcp/pubsub/`. Test and live payment runtimes use separate services, databases,
internal tokens, topics, and service accounts.

Required gateway settings include:

- `APICENTER_PAYMENTS_URL` or the environment-specific shared payment route.
- `APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST` and `_LIVE`.
- `APICENTER_PAYMENT_EVENTS_TOPIC_TEST` and `_LIVE` for event publishing.
- Redis settings for distributed rate limits and idempotency.

The payment runtime requires PayMongo credentials only in its own Secret Manager
binding. Never expose provider credentials to a consumer service or AlphaCI.

## Provisioning

1. Apply the APICenter and payment Cloud Run manifests for the target environment.
2. Apply the matching Pub/Sub topic/subscription/dead-letter manifests.
3. Grant the payment runtime publisher role on the topic.
4. Grant the AlphaCI receiver service account permission to receive push deliveries.
5. Configure the gateway's environment-specific internal route and token secrets.
6. Run the local contract, typecheck, and focused payment tests before live smoke.

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