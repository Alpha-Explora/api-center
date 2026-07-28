# Payment Database Ownership

APICenter is the system of record for provider-backed payment resources, normalized
payment state, public IDs, webhook verification, and outbox events.

AlphaCI keeps a local projection for payment attempts, receipts, subscription and
entitlement state, event inbox status, and reconciliation metadata. It uses the
APICenter SDK for commands and Pub/Sub events for lifecycle updates.

No consumer service receives PayMongo credentials. The former `api-shared` payment
runtime is retired.