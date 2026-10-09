-- Durable records for the SMS, OTP, and email runtimes.
--
-- Each runtime keeps one table per concept. Every row records the tribe, project, source service, and
-- environment that created it. Visibility follows the project: a lookup or OTP verification matches the
-- project and environment, so any service in that project can read the record, and no other project can.
-- The tribe is implied by the project. OTP challenges store the HMAC of the code, never the code.
--
-- The runtime tables from 20261009000700_sms_otp_record_tables.sql and the unused tables from
-- 20260516000000_init_shared_service_schemas.sql are dropped. Production kept these records in Redis,
-- so none of these tables holds production rows.
-- Role grants for the runtime roles are managed by the per-runtime role migration, not here.

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

create index sms_messages_project_created_idx
  on shared_sms.sms_messages (project_id, environment, created_at);

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

create index otp_challenges_project_created_idx
  on shared_otp.otp_challenges (project_id, environment, created_at);
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

create index email_messages_project_created_idx
  on shared_email.email_messages (project_id, environment, created_at);

