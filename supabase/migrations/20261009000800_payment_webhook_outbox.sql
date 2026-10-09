-- Webhook handling writes the receipt, the owner state change and the outbox row in one transaction
-- (apps/payments/src/shared/payment-owner-store.ts, applyVerifiedWebhook).
--
-- aggregate_version counts the state changes of a payment resource. A paid-checkout event carries the
-- version of its checkout so consumers can order events for the same aggregate. The outbox already has
-- an aggregate_version column (20260728000000_payment_runtime_contract.sql); this gives it a source.
--
-- Webhook deduplication reuses payment_webhook_events: its unique index on (provider, provider_mode,
-- provider_event_id) is already scoped by environment, because provider_mode holds 'test' or 'live'.
-- The shared_services_app role already holds select, insert and update on both tables.

ALTER TABLE shared_payment.resource_owners
  ADD COLUMN IF NOT EXISTS aggregate_version integer NOT NULL DEFAULT 1;
