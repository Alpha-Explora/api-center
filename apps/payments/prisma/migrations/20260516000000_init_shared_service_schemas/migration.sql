-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "shared_email";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "shared_gauth";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "shared_geo";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "shared_otp";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "shared_payment";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "shared_sms";

-- CreateTable
CREATE TABLE "shared_payment"."checkout_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'paymongo',
    "provider_mode" TEXT NOT NULL,
    "checkout_id" TEXT NOT NULL,
    "reference_id" TEXT,
    "status" TEXT NOT NULL,
    "amount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "redirect_url" TEXT,
    "success_url" TEXT,
    "cancel_url" TEXT,
    "description" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_payment"."payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'paymongo',
    "provider_mode" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "checkout_id" TEXT,
    "reference_id" TEXT,
    "status" TEXT NOT NULL,
    "amount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "payment_method_type" TEXT,
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_payment"."refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_row_id" UUID,
    "tribe_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'paymongo',
    "provider_mode" TEXT NOT NULL,
    "refund_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "reason" TEXT,
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_payment"."payment_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL DEFAULT 'paymongo',
    "provider_mode" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "payload_hash" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "error_message" TEXT,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_payment"."receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "checkout_session_id" UUID,
    "tribe_id" TEXT NOT NULL,
    "receipt_number" TEXT,
    "reference_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "subtotal" INTEGER,
    "total" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_payment"."receipt_line_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID,
    "checkout_session_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_otp"."otp_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "otp_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target_hash" TEXT NOT NULL,
    "otp_hash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_otp"."otp_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "challenge_id" UUID NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "failure_code" TEXT,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "otp_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_otp"."otp_delivery_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "challenge_id" UUID NOT NULL,
    "provider" TEXT,
    "provider_id" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "otp_delivery_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_email"."email_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'resend',
    "provider_message_id" TEXT,
    "template_id" UUID,
    "recipient_hash" TEXT NOT NULL,
    "subject" TEXT,
    "status" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_email"."email_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_email"."email_delivery_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'resend',
    "provider_id" TEXT,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "email_delivery_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_sms"."sms_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "recipient_hash" TEXT NOT NULL,
    "message_hash" TEXT,
    "status" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_sms"."sms_delivery_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "provider" TEXT,
    "provider_id" TEXT,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "sms_delivery_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_geo"."geocode_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google_maps',
    "query_type" TEXT NOT NULL,
    "query_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result_place_id" TEXT,
    "result_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geocode_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_geo"."normalized_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL DEFAULT 'google_maps',
    "provider_place_id" TEXT,
    "address_hash" TEXT NOT NULL,
    "formatted_address" TEXT,
    "country_code" TEXT,
    "region" TEXT,
    "locality" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "normalized_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_geo"."geofence_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "location_hash" TEXT NOT NULL,
    "geofence_key" TEXT NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "distance_meters" DECIMAL(12,2),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geofence_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_gauth"."oauth_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "state_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "redirect_uri" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_gauth"."oauth_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tribe_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "provider_account_id" TEXT NOT NULL,
    "email_hash" TEXT,
    "display_name" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_gauth"."oauth_token_refs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "token_ref" TEXT NOT NULL,
    "token_type" TEXT NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "expires_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_token_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_checkout_id_key" ON "shared_payment"."checkout_sessions"("checkout_id");

-- CreateIndex
CREATE INDEX "checkout_sessions_tribe_created_idx" ON "shared_payment"."checkout_sessions"("tribe_id", "created_at");

-- CreateIndex
CREATE INDEX "checkout_sessions_status_created_idx" ON "shared_payment"."checkout_sessions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_payment_id_key" ON "shared_payment"."payments"("payment_id");

-- CreateIndex
CREATE INDEX "payments_tribe_created_idx" ON "shared_payment"."payments"("tribe_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_status_created_idx" ON "shared_payment"."payments"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_refund_id_key" ON "shared_payment"."refunds"("refund_id");

-- CreateIndex
CREATE INDEX "refunds_tribe_created_idx" ON "shared_payment"."refunds"("tribe_id", "created_at");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "shared_payment"."refunds"("payment_id");

-- CreateIndex
CREATE INDEX "payment_webhook_type_received_idx" ON "shared_payment"."payment_webhook_events"("event_type", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_provider_mode_provider_even_key" ON "shared_payment"."payment_webhook_events"("provider", "provider_mode", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_checkout_session_id_key" ON "shared_payment"."receipts"("checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_receipt_number_key" ON "shared_payment"."receipts"("receipt_number");

-- CreateIndex
CREATE INDEX "receipts_tribe_issued_idx" ON "shared_payment"."receipts"("tribe_id", "issued_at");

-- CreateIndex
CREATE INDEX "receipt_line_items_receipt_idx" ON "shared_payment"."receipt_line_items"("receipt_id");

-- CreateIndex
CREATE INDEX "receipt_line_items_checkout_idx" ON "shared_payment"."receipt_line_items"("checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "otp_challenges_otp_id_key" ON "shared_otp"."otp_challenges"("otp_id");

-- CreateIndex
CREATE INDEX "otp_challenges_tribe_created_idx" ON "shared_otp"."otp_challenges"("tribe_id", "created_at");

-- CreateIndex
CREATE INDEX "otp_challenges_status_expires_idx" ON "shared_otp"."otp_challenges"("status", "expires_at");

-- CreateIndex
CREATE INDEX "otp_attempts_challenge_attempted_idx" ON "shared_otp"."otp_attempts"("challenge_id", "attempted_at");

-- CreateIndex
CREATE INDEX "otp_delivery_challenge_sent_idx" ON "shared_otp"."otp_delivery_events"("challenge_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_provider_message_id_key" ON "shared_email"."email_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "email_messages_tribe_created_idx" ON "shared_email"."email_messages"("tribe_id", "created_at");

-- CreateIndex
CREATE INDEX "email_messages_status_created_idx" ON "shared_email"."email_messages"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_tribe_id_key_key" ON "shared_email"."email_templates"("tribe_id", "key");

-- CreateIndex
CREATE INDEX "email_delivery_message_occurred_idx" ON "shared_email"."email_delivery_events"("message_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "sms_messages_provider_message_id_key" ON "shared_sms"."sms_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "sms_messages_tribe_created_idx" ON "shared_sms"."sms_messages"("tribe_id", "created_at");

-- CreateIndex
CREATE INDEX "sms_messages_status_created_idx" ON "shared_sms"."sms_messages"("status", "created_at");

-- CreateIndex
CREATE INDEX "sms_delivery_message_occurred_idx" ON "shared_sms"."sms_delivery_events"("message_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "geocode_requests_request_hash_key" ON "shared_geo"."geocode_requests"("request_hash");

-- CreateIndex
CREATE INDEX "geocode_requests_tribe_created_idx" ON "shared_geo"."geocode_requests"("tribe_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "normalized_locations_provider_place_id_key" ON "shared_geo"."normalized_locations"("provider_place_id");

-- CreateIndex
CREATE UNIQUE INDEX "normalized_locations_address_hash_key" ON "shared_geo"."normalized_locations"("address_hash");

-- CreateIndex
CREATE INDEX "normalized_locations_country_region_idx" ON "shared_geo"."normalized_locations"("country_code", "region");

-- CreateIndex
CREATE UNIQUE INDEX "geofence_checks_request_hash_key" ON "shared_geo"."geofence_checks"("request_hash");

-- CreateIndex
CREATE INDEX "geofence_checks_tribe_checked_idx" ON "shared_geo"."geofence_checks"("tribe_id", "checked_at");

-- CreateIndex
CREATE INDEX "geofence_checks_key_matched_idx" ON "shared_geo"."geofence_checks"("geofence_key", "matched");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_sessions_state_hash_key" ON "shared_gauth"."oauth_sessions"("state_hash");

-- CreateIndex
CREATE INDEX "oauth_sessions_tribe_created_idx" ON "shared_gauth"."oauth_sessions"("tribe_id", "created_at");

-- CreateIndex
CREATE INDEX "oauth_sessions_status_expires_idx" ON "shared_gauth"."oauth_sessions"("status", "expires_at");

-- CreateIndex
CREATE INDEX "oauth_accounts_tribe_created_idx" ON "shared_gauth"."oauth_accounts"("tribe_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_tribe_id_provider_provider_account_id_key" ON "shared_gauth"."oauth_accounts"("tribe_id", "provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_token_refs_account_id_token_type_key" ON "shared_gauth"."oauth_token_refs"("account_id", "token_type");

-- AddForeignKey
ALTER TABLE "shared_payment"."refunds" ADD CONSTRAINT "refunds_payment_row_id_fkey" FOREIGN KEY ("payment_row_id") REFERENCES "shared_payment"."payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_payment"."receipts" ADD CONSTRAINT "receipts_checkout_session_id_fkey" FOREIGN KEY ("checkout_session_id") REFERENCES "shared_payment"."checkout_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_payment"."receipt_line_items" ADD CONSTRAINT "receipt_line_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "shared_payment"."receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_payment"."receipt_line_items" ADD CONSTRAINT "receipt_line_items_checkout_session_id_fkey" FOREIGN KEY ("checkout_session_id") REFERENCES "shared_payment"."checkout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_otp"."otp_attempts" ADD CONSTRAINT "otp_attempts_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "shared_otp"."otp_challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_otp"."otp_delivery_events" ADD CONSTRAINT "otp_delivery_events_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "shared_otp"."otp_challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_email"."email_messages" ADD CONSTRAINT "email_messages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "shared_email"."email_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_email"."email_delivery_events" ADD CONSTRAINT "email_delivery_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "shared_email"."email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_sms"."sms_delivery_events" ADD CONSTRAINT "sms_delivery_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "shared_sms"."sms_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_gauth"."oauth_token_refs" ADD CONSTRAINT "oauth_token_refs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "shared_gauth"."oauth_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
