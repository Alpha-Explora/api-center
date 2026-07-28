# APICenter Payments Current Architecture

This document is the current source of truth for the reusable payments platform.

## Ownership

- `api-center/apps/payments` is the private provider adapter. It owns PayMongo credentials, provider calls, webhook verification, the `shared_payment` database, public resource IDs, idempotency, and the payment outbox.
- `api-center/apps/gateway` is the public boundary. Consumer services authenticate with an APICenter payment key and receive the provider-neutral `/api/v1/payments/*` contract.
- AlphaCI keeps its own billing and subscription projection in `alphaci-be`. It calls APICenter through `@alpha-explora/apicenter-sdk`; it does not need PayMongo credentials for the APICenter command path.

## Commands and events

Synchronous commands use the gateway and SDK. Every mutation requires an `Idempotency-Key`. A 202 response is a successful envelope whose `data` is a `PendingResource`; consumers should poll the resource or use the event projection.

Payment lifecycle events use Google Pub/Sub topics:

- `apicenter.payment-events.test`
- `apicenter.payment-events.live`

Subscriptions are filtered by `consumerServiceId`, use OIDC push authentication, and have a dead-letter topic with a 20-delivery policy. Consumers acknowledge malformed or duplicate deliveries after recording the rejection/duplicate state so poison messages do not retry forever.

## Data and recovery

APICenter is the payment source of truth. AlphaCI stores only the local ledger and access projection it needs. AlphaCI's inbox uses a processing lease and can reclaim stale deliveries after five minutes. APICenter's outbox reclaims publishing rows after five minutes, retries with backoff, and quarantines after 20 failed attempts.

Public responses and events never expose raw PayMongo IDs. Provider IDs are encoded as opaque versioned IDs such as `pi_v1_*` and `chk_v1_*`.

## Legacy boundary

The former `api-shared` payment runtime is not part of the active command path. The contract checker tolerates the absent legacy checkout while still validating APICenter-local contracts. Historical Kafka/Confluent payment documents are retained only as archived history; payment event provisioning and delivery use Pub/Sub.