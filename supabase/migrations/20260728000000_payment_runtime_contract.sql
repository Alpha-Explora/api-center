-- APICenter-owned payment runtime contract.
-- The payment service and gateway share this Supabase database, while the
-- shared_payment schema remains isolated from APICenter control-plane schemas.

ALTER TABLE IF EXISTS "shared_payment"."checkout_sessions"
  ADD COLUMN IF NOT EXISTS "aggregate_version" integer NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS "shared_payment"."payments"
  ADD COLUMN IF NOT EXISTS "aggregate_version" integer NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS "shared_payment"."refunds"
  ADD COLUMN IF NOT EXISTS "aggregate_version" integer NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS "shared_payment"."subscriptions"
  ADD COLUMN IF NOT EXISTS "aggregate_version" integer NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS "shared_payment"."invoices"
  ADD COLUMN IF NOT EXISTS "aggregate_version" integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "payment_checkout_aggregate_version_idx"
  ON "shared_payment"."checkout_sessions" ("checkout_id", "aggregate_version");
CREATE INDEX IF NOT EXISTS "payment_payment_aggregate_version_idx"
  ON "shared_payment"."payments" ("payment_id", "aggregate_version");
CREATE INDEX IF NOT EXISTS "payment_subscription_aggregate_version_idx"
  ON "shared_payment"."subscriptions" ("subscription_id", "aggregate_version");
CREATE INDEX IF NOT EXISTS "payment_invoice_aggregate_version_idx"
  ON "shared_payment"."invoices" ("invoice_id", "aggregate_version");

CREATE TABLE IF NOT EXISTS "shared_payment"."payment_event_outbox" (
  "id" uuid primary key default gen_random_uuid(),
  "environment" text not null,
  "provider" text not null default 'paymongo',
  "provider_event_id" text not null,
  "event_type" text not null,
  "aggregate_type" text not null,
  "aggregate_id" text not null,
  "aggregate_version" integer not null default 1,
  "payload" jsonb not null default '{}'::jsonb,
  "status" text not null default 'pending',
  "attempts" integer not null default 0,
  "available_at" timestamptz not null default now(),
  "published_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  constraint "payment_outbox_env_provider_event_uidx"
    unique ("environment", "provider", "provider_event_id")
);

ALTER TABLE IF EXISTS "shared_payment"."payment_event_outbox"
  ADD COLUMN IF NOT EXISTS "owner_tribe_id" text,
  ADD COLUMN IF NOT EXISTS "consumer_service_id" text,
  ADD COLUMN IF NOT EXISTS "reference_id" text,
  ADD COLUMN IF NOT EXISTS "quarantine_reason" text,
  ADD COLUMN IF NOT EXISTS "quarantine_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "quarantined_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "quarantine_expires_at" timestamptz;

UPDATE "shared_payment"."payment_event_outbox"
SET
  "owner_tribe_id" = COALESCE("owner_tribe_id", "payload"->>'ownerTribeId'),
  "consumer_service_id" = COALESCE("consumer_service_id", "payload"->>'consumerServiceId'),
  "reference_id" = COALESCE("reference_id", "payload"->>'referenceId')
WHERE "owner_tribe_id" IS NULL
   OR "consumer_service_id" IS NULL
   OR "reference_id" IS NULL;

CREATE INDEX IF NOT EXISTS "payment_outbox_status_available_idx"
  ON "shared_payment"."payment_event_outbox" ("status", "available_at");
CREATE INDEX IF NOT EXISTS "payment_outbox_consumer_pending_idx"
  ON "shared_payment"."payment_event_outbox"
    ("consumer_service_id", "environment", "status", "available_at");
CREATE INDEX IF NOT EXISTS "payment_outbox_quarantine_retry_idx"
  ON "shared_payment"."payment_event_outbox"
    ("status", "available_at", "quarantine_expires_at")
  WHERE "status" = 'quarantined';
