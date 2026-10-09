create table shared_email.email_delivery_events (
  provider_event_id text primary key,
  message_id text not null,
  status text not null check (status in (
    'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed', 'opened', 'clicked'
  )),
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index email_delivery_events_message_id_idx
  on shared_email.email_delivery_events (message_id, received_at desc);
create index email_delivery_events_received_at_idx
  on shared_email.email_delivery_events (received_at);
comment on table shared_email.email_delivery_events is 'retention=400d; Resend delivery events keyed by unique provider event ID.';
grant select, insert, update on shared_email.email_delivery_events to email_runtime;

create table shared_sms.sms_delivery_events (
  provider_event_id text primary key,
  message_id text not null,
  status text not null check (status in (
    'accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'read', 'canceled'
  )),
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index sms_delivery_events_message_id_idx
  on shared_sms.sms_delivery_events (message_id, received_at desc);
create index sms_delivery_events_received_at_idx
  on shared_sms.sms_delivery_events (received_at);
comment on table shared_sms.sms_delivery_events is 'retention=400d; Twilio status callbacks keyed by unique provider event ID.';
grant select, insert, update on shared_sms.sms_delivery_events to sms_runtime;

grant usage on schema shared_email, shared_sms to api_center_retention;
grant select, delete on shared_email.email_delivery_events, shared_sms.sms_delivery_events to api_center_retention;
