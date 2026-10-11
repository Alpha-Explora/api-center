---
title: "Payment Database Ownership"
status: canonical
authority: operational
owner: platform-operators
audience: [operators, engineers]
last_verified: "unverified"
verification: unverified
sources: ["packages/contracts/src/index.ts","apps/payments/src/server.ts"]
---
# Payment Database Ownership

PayMongo is the system of record for provider-backed payment resources and merchant
settlement. APICenter stores the project/environment ownership mapping and payment
listing/reconciliation facts it needs, verifies webhooks, and persists webhook receipts
and outbox events. It does not keep copied PayMongo resource tables.

AlphaCI keeps a local projection for payment attempts, receipts, subscription and
entitlement state, event inbox status, and reconciliation metadata. It uses the
APICenter SDK for commands and Pub/Sub events for lifecycle updates.

No consumer service receives PayMongo credentials. The former `api-shared` payment
runtime is retired.
