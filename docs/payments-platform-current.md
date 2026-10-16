---
title: "APICenter Payments Current Architecture"
status: canonical
authority: informative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "2026-10-12"
verification: repository
sources: ["packages/contracts/src/index.ts","apps/payments/src/server.ts"]
---
# APICenter Payments Current Architecture

This document is the current source of truth for the reusable payments platform.

## Ownership

- `api-center/apps/payments` is the private provider adapter. It owns PayMongo credentials, provider calls, webhook verification, public resource IDs, idempotency, and the payment outbox. PayMongo owns the canonical customer, product, price, subscription, checkout, payment, refund, invoice, and receipt records.
- `shared_payment` stores APICenter's project-scoped resource ownership and reconciliation facts, verified webhook receipts, and event outbox. It does not mirror PayMongo's provider resource tables.
- `api-center/apps/gateway` is the public boundary. Consumer services use service credentials and, when provisioned, a payment API key to call the provider-neutral `/api/v1/payments/*` contract.
- No consumer repository outside APICenter is currently onboarded to the published SDK. A consuming service owns its own billing and subscription projection; it does not receive PayMongo credentials.

## Commands and events

Synchronous commands use the gateway and SDK. Every mutation requires an `Idempotency-Key`. A 202 response is a successful envelope whose `data` is a `PendingResource`; consumers should poll the resource or use the event projection.

Payment lifecycle events use Google Pub/Sub topics:

- `apicenter.payment-events.test`
- `apicenter.payment-events.live`

Subscriptions are filtered by `consumerServiceId`, use OIDC push authentication, and have a dead-letter topic with a 20-delivery policy. Consumers acknowledge malformed or duplicate deliveries after recording the rejection/duplicate state so poison messages do not retry forever.

## Data and recovery

Checkout reads by ID and merchant reference check project/environment ownership before retrieving PayMongo state. Payment status comes from a paid payment or a succeeded payment intent, not the checkout session's `active` lifecycle status. A confirmed payment takes precedence over session expiration. Unpaid active sessions remain pending.

Reads reconcile the checkout ownership snapshot and listing status atomically. An unchanged read keeps its aggregate version, and a stale poll cannot overwrite a webhook-confirmed paid checkout. Polling does not fabricate webhook receipts or queue lifecycle events. Signed provider webhooks remain responsible for recording payment resources and queueing events; a later webhook still queues its event once after polling has recovered the checkout status.

PayMongo is the source of truth for payment resources and merchant settlement. APICenter is the source of truth for the project/environment ownership mapping, payment listing and reconciliation metadata it records, webhook verification receipts, and event delivery state. A consumer stores only the local ledger and access projection its product needs. APICenter's outbox reclaims publishing rows after five minutes, retries with backoff, and quarantines after 20 failed attempts.

Public responses and events never expose raw PayMongo IDs. Provider IDs are encoded as opaque versioned IDs such as `pi_v1_*` and `chk_v1_*`.

## Legacy boundary

The former `api-shared` payment runtime is not part of the active command path. The contract checker tolerates the absent legacy checkout while still validating APICenter-local contracts. Historical Kafka/Confluent payment documents are retained only as archived history; payment event provisioning and delivery use Pub/Sub.
