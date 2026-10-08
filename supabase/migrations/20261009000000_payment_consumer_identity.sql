-- Payment consumer identity: registered payment consumers and their hashed API keys.
--
-- The gateway reads and writes these tables (payment-consumer-management.service.ts and
-- payment-api-key.service.ts), but they were only created by the legacy Prisma migration
-- prisma/migrations/20260727000000_add_payment_consumer_identity, which nothing runs. A database built
-- from this chain therefore had no payment consumers or keys.
--
-- owner_tribe_id and consumer_service_id are plain identifiers with no foreign key into apic_catalog:
-- the registry validates them before registration, and the rows stay valid if a service is archived.
--
-- The legacy migration also created payment_idempotency_records. No code uses it (payment idempotency
-- lives in Redis), so it is not recreated here.

create table if not exists apic_governance.payment_consumer_services (
  id uuid primary key default gen_random_uuid(),
  owner_tribe_id text not null,
  consumer_service_id text not null,
  environment text not null
    constraint payment_consumer_services_environment_check check (environment in ('test', 'live')),
  event_endpoint_url text,
  status text not null default 'active'
    constraint payment_consumer_services_status_check check (status in ('active', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_consumer_services_owner_service_env_key unique (owner_tribe_id, consumer_service_id, environment)
);

create table if not exists apic_governance.payment_api_keys (
  id uuid primary key default gen_random_uuid(),
  consumer_service_id uuid not null
    references apic_governance.payment_consumer_services(id) on delete cascade,
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default array['payments:read', 'payments:write'],
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists payment_api_keys_consumer_service_idx
  on apic_governance.payment_api_keys (consumer_service_id);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'api_center_app') then
    grant select, insert, update
      on apic_governance.payment_consumer_services, apic_governance.payment_api_keys
      to api_center_app;
  end if;
end $$;
