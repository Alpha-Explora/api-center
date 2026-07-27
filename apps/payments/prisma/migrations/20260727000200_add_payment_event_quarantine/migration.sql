ALTER TABLE "shared_payment"."payment_event_outbox"
  ADD COLUMN IF NOT EXISTS "quarantine_reason" text,
  ADD COLUMN IF NOT EXISTS "quarantine_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "quarantined_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "quarantine_expires_at" timestamptz;

CREATE INDEX IF NOT EXISTS "payment_outbox_quarantine_retry_idx"
  ON "shared_payment"."payment_event_outbox" ("status", "available_at", "quarantine_expires_at")
  WHERE "status" = 'quarantined';