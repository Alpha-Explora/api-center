-- Normalize public payment resources and make lifecycle versions explicit.
ALTER TABLE "shared_payment"."checkout_sessions"
  ADD COLUMN IF NOT EXISTS "aggregate_version" integer NOT NULL DEFAULT 1;
ALTER TABLE "shared_payment"."payments"
  ADD COLUMN IF NOT EXISTS "aggregate_version" integer NOT NULL DEFAULT 1;
ALTER TABLE "shared_payment"."refunds"
  ADD COLUMN IF NOT EXISTS "aggregate_version" integer NOT NULL DEFAULT 1;
ALTER TABLE "shared_payment"."subscriptions"
  ADD COLUMN IF NOT EXISTS "aggregate_version" integer NOT NULL DEFAULT 1;
ALTER TABLE "shared_payment"."invoices"
  ADD COLUMN IF NOT EXISTS "aggregate_version" integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "payment_checkout_aggregate_version_idx"
  ON "shared_payment"."checkout_sessions" ("checkout_id", "aggregate_version");
CREATE INDEX IF NOT EXISTS "payment_payment_aggregate_version_idx"
  ON "shared_payment"."payments" ("payment_id", "aggregate_version");
CREATE INDEX IF NOT EXISTS "payment_subscription_aggregate_version_idx"
  ON "shared_payment"."subscriptions" ("subscription_id", "aggregate_version");
CREATE INDEX IF NOT EXISTS "payment_invoice_aggregate_version_idx"
  ON "shared_payment"."invoices" ("invoice_id", "aggregate_version");