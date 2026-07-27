-- Add Stripe-like catalog and subscription persistence for the PayMongo shared service.

CREATE TABLE IF NOT EXISTS "shared_payment"."customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'paymongo',
    "provider_mode" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "shared_payment"."products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "shared_payment"."prices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "product_row_id" UUID,
    "price_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "amount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "recurring_interval" TEXT,
    "recurring_interval_count" INTEGER,
    "trial_period_days" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "shared_payment"."subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "customer_row_id" UUID,
    "price_row_id" UUID,
    "provider" TEXT NOT NULL DEFAULT 'paymongo',
    "provider_mode" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "reference_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "price_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "current_period_start" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "latest_invoice_id" TEXT,
    "latest_payment_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "shared_payment"."subscription_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL DEFAULT 'paymongo',
    "provider_mode" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "error_message" TEXT,
    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "shared_payment"."invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "subscription_row_id" UUID,
    "customer_row_id" UUID,
    "provider" TEXT NOT NULL DEFAULT 'paymongo',
    "provider_mode" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "customer_id" TEXT,
    "status" TEXT NOT NULL,
    "amount_due" INTEGER,
    "amount_paid" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "due_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "shared_payment"."invoice_line_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customers_customer_id_key" ON "shared_payment"."customers"("customer_id");
CREATE INDEX IF NOT EXISTS "payment_customers_tribe_created_idx" ON "shared_payment"."customers"("tribe_id", "created_at");
CREATE INDEX IF NOT EXISTS "payment_customers_provider_customer_idx" ON "shared_payment"."customers"("provider", "provider_mode", "customer_id");

CREATE UNIQUE INDEX IF NOT EXISTS "products_product_id_key" ON "shared_payment"."products"("product_id");
CREATE INDEX IF NOT EXISTS "payment_products_tribe_active_idx" ON "shared_payment"."products"("tribe_id", "active");

CREATE UNIQUE INDEX IF NOT EXISTS "prices_price_id_key" ON "shared_payment"."prices"("price_id");
CREATE INDEX IF NOT EXISTS "payment_prices_tribe_product_idx" ON "shared_payment"."prices"("tribe_id", "product_id");
CREATE INDEX IF NOT EXISTS "payment_prices_tribe_active_idx" ON "shared_payment"."prices"("tribe_id", "active");

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_subscription_id_key" ON "shared_payment"."subscriptions"("subscription_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_subscriptions_tribe_reference_key" ON "shared_payment"."subscriptions"("tribe_id", "reference_id") WHERE "reference_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "payment_subscriptions_tribe_status_created_idx" ON "shared_payment"."subscriptions"("tribe_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "payment_subscriptions_customer_id_idx" ON "shared_payment"."subscriptions"("customer_id");

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_events_provider_event" ON "shared_payment"."subscription_events"("provider", "provider_mode", "provider_event_id");
CREATE INDEX IF NOT EXISTS "subscription_events_subscription_received_idx" ON "shared_payment"."subscription_events"("subscription_id", "received_at");
CREATE INDEX IF NOT EXISTS "subscription_events_type_received_idx" ON "shared_payment"."subscription_events"("event_type", "received_at");

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_invoice_id_key" ON "shared_payment"."invoices"("invoice_id");
CREATE INDEX IF NOT EXISTS "payment_invoices_tribe_created_idx" ON "shared_payment"."invoices"("tribe_id", "created_at");
CREATE INDEX IF NOT EXISTS "payment_invoices_subscription_created_idx" ON "shared_payment"."invoices"("subscription_id", "created_at");
CREATE INDEX IF NOT EXISTS "invoice_line_items_invoice_idx" ON "shared_payment"."invoice_line_items"("invoice_id");

ALTER TABLE "shared_payment"."prices"
  ADD CONSTRAINT "prices_product_row_id_fkey"
  FOREIGN KEY ("product_row_id") REFERENCES "shared_payment"."products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shared_payment"."subscriptions"
  ADD CONSTRAINT "subscriptions_customer_row_id_fkey"
  FOREIGN KEY ("customer_row_id") REFERENCES "shared_payment"."customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shared_payment"."subscriptions"
  ADD CONSTRAINT "subscriptions_price_row_id_fkey"
  FOREIGN KEY ("price_row_id") REFERENCES "shared_payment"."prices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shared_payment"."invoices"
  ADD CONSTRAINT "invoices_subscription_row_id_fkey"
  FOREIGN KEY ("subscription_row_id") REFERENCES "shared_payment"."subscriptions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shared_payment"."invoices"
  ADD CONSTRAINT "invoices_customer_row_id_fkey"
  FOREIGN KEY ("customer_row_id") REFERENCES "shared_payment"."customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shared_payment"."invoice_line_items"
  ADD CONSTRAINT "invoice_line_items_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "shared_payment"."invoices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
