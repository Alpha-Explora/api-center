create table apic_governance.api_subscriptions (
  id uuid primary key default gen_random_uuid(),
  consumer_project_id text not null,
  api_service_id text not null,
  environment text not null check (environment in ('test', 'live')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'revoked')),
  requested_by text not null,
  decided_by text,
  decided_at timestamptz,
  reason text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_subscriptions_decision_metadata_check check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null)
  )
);

create unique index api_subscriptions_one_pending_request_idx
  on apic_governance.api_subscriptions (consumer_project_id, api_service_id, environment)
  where status = 'pending';
create index api_subscriptions_consumer_idx
  on apic_governance.api_subscriptions (consumer_project_id, environment, status, requested_at desc);
create index api_subscriptions_api_idx
  on apic_governance.api_subscriptions (api_service_id, environment, status, requested_at desc);
create unique index api_subscriptions_one_approved_grant_idx
  on apic_governance.api_subscriptions (consumer_project_id, api_service_id, environment)
  where status = 'approved';

grant select, insert, update on apic_governance.api_subscriptions to api_center_app;
revoke delete, truncate on apic_governance.api_subscriptions from api_center_app;
