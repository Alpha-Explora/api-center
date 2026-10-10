-- Project and environment payment guardrails. The rate-window table keeps one row per
-- project/environment and replaces its minute bucket atomically, so it does not grow with traffic.

create table apic_governance.payment_limit_overrides (
  owner_tribe_id text not null,
  project_id text not null,
  environment text not null
    constraint payment_limit_overrides_environment_check check (environment in ('test', 'live')),
  maximum_payment_amount_minor bigint not null
    constraint payment_limit_overrides_amount_check check (maximum_payment_amount_minor > 0),
  payment_requests_per_minute integer not null
    constraint payment_limit_overrides_requests_check check (payment_requests_per_minute > 0),
  reason text not null constraint payment_limit_overrides_reason_check check (length(btrim(reason)) > 0),
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_limit_overrides_project_environment_key unique (project_id, environment)
);

create table apic_governance.payment_request_rate_windows (
  project_id text not null,
  environment text not null
    constraint payment_request_rate_windows_environment_check check (environment in ('test', 'live')),
  window_started_at timestamptz not null,
  request_count integer not null constraint payment_request_rate_windows_count_check check (request_count > 0),
  constraint payment_request_rate_windows_pkey primary key (project_id, environment)
);

comment on table apic_governance.payment_request_rate_windows is
  'Bounded counter: one row per project/environment; each request atomically replaces or increments the current minute window.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'api_center_app') then
    grant select, insert, update, delete
      on apic_governance.payment_limit_overrides, apic_governance.payment_request_rate_windows
      to api_center_app;
  end if;
end $$;
