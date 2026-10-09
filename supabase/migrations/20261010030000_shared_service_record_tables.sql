-- Durable records for the SMS, OTP, and email runtimes.
--
-- Each runtime keeps one table per concept. Every row records the caller that created it: tribe, project,
-- source service, and environment. Lookups and OTP verification match all four, so a caller reads only its
-- own records. OTP challenges store the HMAC of the code, never the code.
--
-- The runtime tables from 20261009000700_sms_otp_record_tables.sql and the unused tables from
-- 20260516000000_init_shared_service_schemas.sql are dropped. Production kept these records in Redis,
-- so none of these tables holds production rows.

drop table if exists shared_sms.sms_delivery_events cascade;
drop table if exists shared_sms.sms_records cascade;
drop table if exists shared_sms.sms_messages cascade;
drop table if exists shared_otp.otp_delivery_events cascade;
drop table if exists shared_otp.otp_attempts cascade;
drop table if exists shared_otp.otp_records cascade;
drop table if exists shared_otp.otp_challenges cascade;
drop table if exists shared_email.email_delivery_events cascade;
drop table if exists shared_email.email_templates cascade;
drop table if exists shared_email.email_messages cascade;

create table shared_sms.sms_messages (
  message_id text primary key,
  tribe_id text not null,
  project_id text not null,
  service_id text not null,
  environment text not null check (environment in ('test', 'live')),
  recipient text not null,
  message text not null,
  status text not null,
  sender_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sms_messages_owner_created_idx
  on shared_sms.sms_messages (tribe_id, project_id, service_id, environment, created_at);

create table shared_otp.otp_challenges (
  otp_id text primary key,
  tribe_id text not null,
  project_id text not null,
  service_id text not null,
  environment text not null check (environment in ('test', 'live')),
  channel text not null check (channel in ('sms', 'email')),
  target text not null,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('pending', 'used', 'expired')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index otp_challenges_owner_created_idx
  on shared_otp.otp_challenges (tribe_id, project_id, service_id, environment, created_at);
create index otp_challenges_status_expires_idx
  on shared_otp.otp_challenges (status, expires_at);

create table shared_email.email_messages (
  message_id text primary key,
  tribe_id text not null,
  project_id text not null,
  service_id text not null,
  environment text not null check (environment in ('test', 'live')),
  provider text not null,
  status text not null,
  recipients text[] not null,
  recipient_count integer not null check (recipient_count >= 0),
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_messages_owner_created_idx
  on shared_email.email_messages (tribe_id, project_id, service_id, environment, created_at);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'shared_services_app') then
    grant usage on schema shared_sms, shared_otp, shared_email to shared_services_app;
    grant select, insert, update on shared_sms.sms_messages, shared_otp.otp_challenges, shared_email.email_messages to shared_services_app;
  end if;
end $$;

