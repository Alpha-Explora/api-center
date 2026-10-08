-- Tables for the Postgres-backed SMS and OTP stores.
--
-- apps/sms and apps/otp store messages and OTP challenges in shared_sms.sms_records and
-- shared_otp.otp_records. Until now those tables existed only because the stores ran CREATE TABLE IF NOT
-- EXISTS at runtime, so no migration defined them and the runtime role needed DDL rights. The stores no
-- longer create anything; this migration is the single definition.
--
-- It also corrects a defect in the runtime definition. otp_records.code holds the HMAC-SHA256 hash of the
-- OTP (hashOtpCode returns 64 hex characters), but the runtime created the column as varchar(32), so every
-- insert failed with "value too long for type character varying(32)". The column is text here, and the
-- alter below repairs a table the runtime already created.
--
-- The migration-defined shared_sms.sms_messages and shared_otp.otp_challenges tables are not used by any
-- store and are left alone until their deployed row counts are checked.

create table if not exists shared_sms.sms_records (
  message_id varchar(64) primary key,
  recipient varchar(255) not null,
  message text not null,
  status varchar(32) not null,
  sender_id varchar(64),
  created_at timestamptz not null default now()
);

create index if not exists idx_sms_recipient on shared_sms.sms_records (recipient);

create table if not exists shared_otp.otp_records (
  otp_id varchar(64) primary key,
  target varchar(255) not null,
  channel varchar(16) not null,
  code text not null,
  expires_at bigint not null,
  status varchar(32) not null,
  created_at timestamptz not null default now()
);

alter table shared_otp.otp_records alter column code type text;

create index if not exists idx_otp_target on shared_otp.otp_records (target);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'shared_services_app') then
    grant usage on schema shared_sms, shared_otp to shared_services_app;
    grant select, insert, update on shared_sms.sms_records, shared_otp.otp_records to shared_services_app;
  end if;
end $$;
