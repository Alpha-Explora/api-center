ALTER TABLE "shared_payment"."payment_event_outbox"
  ADD COLUMN IF NOT EXISTS "owner_tribe_id" text,
  ADD COLUMN IF NOT EXISTS "consumer_service_id" text,
  ADD COLUMN IF NOT EXISTS "reference_id" text;

UPDATE "shared_payment"."payment_event_outbox"
SET
  owner_tribe_id = COALESCE(owner_tribe_id, payload->>'ownerTribeId'),
  consumer_service_id = COALESCE(consumer_service_id, payload->>'consumerServiceId'),
  reference_id = COALESCE(reference_id, payload->>'referenceId')
WHERE owner_tribe_id IS NULL OR consumer_service_id IS NULL OR reference_id IS NULL;

CREATE INDEX IF NOT EXISTS "payment_outbox_consumer_pending_idx"
  ON "shared_payment"."payment_event_outbox" ("consumer_service_id", "environment", "status", "available_at");