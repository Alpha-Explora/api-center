create table if not exists "shared_payment"."payment_event_outbox" (
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
  constraint "payment_outbox_env_provider_event_uidx" unique ("environment", "provider", "provider_event_id")
);
create index if not exists "payment_outbox_status_available_idx"
  on "shared_payment"."payment_event_outbox" ("status", "available_at");
