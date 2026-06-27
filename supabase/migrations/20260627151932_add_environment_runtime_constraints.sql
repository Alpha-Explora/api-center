-- Task 7A: make runtime/control-plane records environment-aware without using test/live schemas.
-- Application code must provide environment explicitly. These columns intentionally have no defaults.

create or replace function pg_temp.add_constraint_if_missing(
  p_schema text,
  p_table text,
  p_constraint text,
  p_clause text
) returns void
language plpgsql
as $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = p_schema
      and rel.relname = p_table
      and c.conname = p_constraint
  ) then
    execute format('alter table %I.%I add constraint %I %s', p_schema, p_table, p_constraint, p_clause);
  end if;
end;
$$;

-- Existing environment-bearing control-plane tables: enforce test/live for future writes without silently rewriting history.
select pg_temp.add_constraint_if_missing('apic_catalog', 'service_environments', 'service_environments_environment_check', 'check (environment in (''test'', ''live'')) not valid');
select pg_temp.add_constraint_if_missing('apic_governance', 'approval_requests', 'approval_requests_target_environment_check', 'check (target_environment in (''test'', ''live'')) not valid');
select pg_temp.add_constraint_if_missing('apic_governance', 'entitlement_assignments', 'entitlement_assignments_environment_check', 'check (environment in (''test'', ''live'')) not valid');
select pg_temp.add_constraint_if_missing('apic_runtime', 'event_topic_onboarding_states', 'event_topic_onboarding_states_environment_check', 'check (environment in (''test'', ''live'')) not valid');
select pg_temp.add_constraint_if_missing('apic_runtime', 'pipeline_feedback_actions', 'pipeline_feedback_actions_environment_check', 'check (environment in (''test'', ''live'')) not valid');

alter table apic_runtime.health_snapshots
  add column if not exists environment text;

with single_environment as (
  select service_id, min(environment) as environment
  from apic_catalog.service_environments
  where environment in ('test', 'live')
  group by service_id
  having count(distinct environment) = 1
)
update apic_runtime.health_snapshots snapshot
set environment = single_environment.environment
from single_environment
where snapshot.service_id = single_environment.service_id
  and snapshot.environment is null;

do $$
begin
  if exists (select 1 from apic_runtime.health_snapshots where environment is null) then
    raise exception 'health_snapshots contains rows that cannot be classified as test/live; complete Task 0 inventory backfill before enforcing environment';
  end if;
end;
$$;

alter table apic_runtime.health_snapshots
  alter column environment set not null;
select pg_temp.add_constraint_if_missing('apic_runtime', 'health_snapshots', 'health_snapshots_environment_check', 'check (environment in (''test'', ''live''))');
create index if not exists health_snapshots_service_env_checked_idx on apic_runtime.health_snapshots(service_id, environment, checked_at desc);

alter table apic_runtime.smoke_test_runs
  add column if not exists environment text;

do $$
begin
  if exists (
    with service_environment as (
      select service_id, min(environment) as environment
      from apic_catalog.service_environments
      where environment in ('test', 'live')
      group by service_id
      having count(distinct environment) = 1
    )
    select 1
    from apic_runtime.smoke_test_runs run
    join service_environment service_env on run.service_id = service_env.service_id
    join service_environment tribe_env on run.tribe_service_id = tribe_env.service_id
    where service_env.environment <> tribe_env.environment
  ) then
    raise exception 'smoke_test_runs contains service and tribe-service environments that disagree; inventory-backfill explicitly before enforcing environment';
  end if;
end;
$$;


with service_environment as (
  select service_id, min(environment) as environment
  from apic_catalog.service_environments
  where environment in ('test', 'live')
  group by service_id
  having count(distinct environment) = 1
)
update apic_runtime.smoke_test_runs run
set environment = service_environment.environment
from service_environment
where run.environment is null
  and run.service_id = service_environment.service_id;

with service_environment as (
  select service_id, min(environment) as environment
  from apic_catalog.service_environments
  where environment in ('test', 'live')
  group by service_id
  having count(distinct environment) = 1
)
update apic_runtime.smoke_test_runs run
set environment = service_environment.environment
from service_environment
where run.environment is null
  and run.tribe_service_id = service_environment.service_id;

do $$
begin
  if exists (select 1 from apic_runtime.smoke_test_runs where environment is null) then
    raise exception 'smoke_test_runs contains rows that cannot be classified as test/live; complete Task 0 inventory backfill before enforcing environment';
  end if;
end;
$$;

alter table apic_runtime.smoke_test_runs
  alter column environment set not null;
select pg_temp.add_constraint_if_missing('apic_runtime', 'smoke_test_runs', 'smoke_test_runs_environment_check', 'check (environment in (''test'', ''live''))');
create index if not exists smoke_test_runs_service_env_created_idx on apic_runtime.smoke_test_runs(service_id, environment, created_at desc);
create index if not exists smoke_test_runs_tribe_service_env_created_idx on apic_runtime.smoke_test_runs(tribe_service_id, environment, created_at desc);

alter table apic_runtime.usage_rollups
  add column if not exists environment text;

do $$
begin
  if exists (
    with single_environment as (
      select service_id, min(environment) as environment
      from apic_catalog.service_environments
      where environment in ('test', 'live')
      group by service_id
      having count(distinct environment) = 1
    )
    select 1
    from apic_runtime.usage_rollups rollup
    join single_environment consumer_env on rollup.consumer_service_id = consumer_env.service_id
    join single_environment target_env on rollup.target_service_id = target_env.service_id
    where consumer_env.environment <> target_env.environment
  ) then
    raise exception 'usage_rollups contains consumer and target service environments that disagree; inventory-backfill explicitly before enforcing environment';
  end if;
end;
$$;


with single_environment as (
  select service_id, min(environment) as environment
  from apic_catalog.service_environments
  where environment in ('test', 'live')
  group by service_id
  having count(distinct environment) = 1
)
update apic_runtime.usage_rollups rollup
set environment = single_environment.environment
from single_environment
where rollup.environment is null
  and rollup.consumer_service_id = single_environment.service_id;

with single_environment as (
  select service_id, min(environment) as environment
  from apic_catalog.service_environments
  where environment in ('test', 'live')
  group by service_id
  having count(distinct environment) = 1
)
update apic_runtime.usage_rollups rollup
set environment = single_environment.environment
from single_environment
where rollup.environment is null
  and rollup.target_service_id = single_environment.service_id;

do $$
begin
  if exists (select 1 from apic_runtime.usage_rollups where environment is null) then
    raise exception 'usage_rollups contains rows that cannot be classified as test/live; complete Task 0 inventory backfill before enforcing environment';
  end if;
end;
$$;

alter table apic_runtime.usage_rollups
  alter column environment set not null;
select pg_temp.add_constraint_if_missing('apic_runtime', 'usage_rollups', 'usage_rollups_environment_check', 'check (environment in (''test'', ''live''))');

do $$
declare
  existing_constraint record;
begin
  for existing_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'apic_runtime.usage_rollups'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) = 'UNIQUE (window_start, window_end, consumer_service_id, target_service_id, route_family)'
  loop
    execute format('alter table apic_runtime.usage_rollups drop constraint %I', existing_constraint.conname);
  end loop;
end;
$$;

create index if not exists usage_rollups_environment_window_idx on apic_runtime.usage_rollups(environment, window_start desc);
create unique index if not exists usage_rollups_env_service_target_window_uidx on apic_runtime.usage_rollups(environment, consumer_service_id, target_service_id, route_family, window_start, window_end);

alter table apic_runtime.quota_evaluations
  add column if not exists environment text;


do $$
begin
  if exists (select 1 from apic_runtime.quota_evaluations where environment is null) then
    raise exception 'quota_evaluations contains rows without environment; replay or inventory-backfill quota decisions before enforcing environment';
  end if;
end;
$$;

alter table apic_runtime.quota_evaluations
  alter column environment set not null;
select pg_temp.add_constraint_if_missing('apic_runtime', 'quota_evaluations', 'quota_evaluations_environment_check', 'check (environment in (''test'', ''live''))');
create index if not exists quota_evaluations_environment_owner_created_idx on apic_runtime.quota_evaluations(environment, owner_tribe_id, created_at desc);
create index if not exists quota_evaluations_env_route_window_idx on apic_runtime.quota_evaluations(environment, owner_tribe_id, route_family, window_start desc);

alter table apic_audit.audit_events
  add column if not exists environment text,
  add column if not exists source_service_id text,
  add column if not exists service_id text,
  add column if not exists tribe_id text;

update apic_audit.audit_events event
set environment = event.metadata ->> 'environment'
where event.environment is null
  and event.metadata ? 'environment'
  and event.metadata ->> 'environment' in ('test', 'live');

update apic_audit.audit_events event
set source_service_id = coalesce(event.source_service_id, event.metadata ->> 'sourceServiceId', event.metadata ->> 'source_service_id'),
    service_id = coalesce(event.service_id, event.metadata ->> 'serviceId', event.metadata ->> 'service_id'),
    tribe_id = coalesce(event.tribe_id, event.metadata ->> 'tribeId', event.metadata ->> 'ownerTribeId', event.metadata ->> 'tribe_id', event.metadata ->> 'owner_tribe_id')
where event.metadata <> '{}'::jsonb;

do $$
begin
  if exists (select 1 from apic_audit.audit_events where environment is null) then
    raise exception 'audit_events contains rows without first-class environment; inventory-backfill audit history before enforcing durable compliance exports';
  end if;
end;
$$;

alter table apic_audit.audit_events
  alter column environment set not null;
select pg_temp.add_constraint_if_missing('apic_audit', 'audit_events', 'audit_events_environment_check', 'check (environment in (''test'', ''live''))');
create index if not exists audit_events_env_resource_correlation_idx on apic_audit.audit_events(environment, resource_type, resource_id, correlation_id, created_at desc);
create index if not exists audit_events_source_env_created_idx on apic_audit.audit_events(source_service_id, environment, created_at desc);
create index if not exists audit_events_tribe_env_created_idx on apic_audit.audit_events(tribe_id, environment, created_at desc);

create table if not exists apic_governance.promotion_evidence_bundles (
  id uuid primary key default gen_random_uuid(),
  service_id text not null,
  source_environment text not null,
  target_environment text not null,
  correlation_id text,
  generated_by text,
  ready boolean not null default false,
  bundle jsonb not null,
  created_at timestamptz not null default now(),
  generated_at timestamptz not null default now()
);
select pg_temp.add_constraint_if_missing('apic_governance', 'promotion_evidence_bundles', 'promotion_evidence_source_environment_check', 'check (source_environment in (''test'', ''live''))');
select pg_temp.add_constraint_if_missing('apic_governance', 'promotion_evidence_bundles', 'promotion_evidence_target_environment_check', 'check (target_environment in (''test'', ''live''))');
select pg_temp.add_constraint_if_missing('apic_governance', 'promotion_evidence_bundles', 'promotion_evidence_distinct_environment_check', 'check (source_environment <> target_environment)');
create index if not exists promotion_evidence_service_env_created_idx on apic_governance.promotion_evidence_bundles(service_id, source_environment, target_environment, created_at desc);
create index if not exists promotion_evidence_correlation_idx on apic_governance.promotion_evidence_bundles(correlation_id);

create table if not exists apic_catalog.shared_service_runtime_routes (
  id uuid primary key default gen_random_uuid(),
  shared_service_id text not null,
  environment text not null,
  runtime_url text not null,
  status text not null default 'active',
  provider_mode text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select pg_temp.add_constraint_if_missing('apic_catalog', 'shared_service_runtime_routes', 'shared_service_runtime_routes_environment_check', 'check (environment in (''test'', ''live''))');
select pg_temp.add_constraint_if_missing('apic_catalog', 'shared_service_runtime_routes', 'shared_service_runtime_routes_status_check', 'check (status in (''active'', ''disabled'', ''retired''))');
create unique index if not exists shared_service_runtime_routes_service_env_uidx on apic_catalog.shared_service_runtime_routes(shared_service_id, environment);
create index if not exists shared_service_runtime_routes_env_status_idx on apic_catalog.shared_service_runtime_routes(environment, status);

create or replace view apic_runtime.live_usage_rollups with (security_invoker = true) as
select * from apic_runtime.usage_rollups where environment = 'live';
create or replace view apic_runtime.test_usage_rollups with (security_invoker = true) as
select * from apic_runtime.usage_rollups where environment = 'test';
create or replace view apic_runtime.live_quota_evaluations with (security_invoker = true) as
select * from apic_runtime.quota_evaluations where environment = 'live';
create or replace view apic_runtime.test_quota_evaluations with (security_invoker = true) as
select * from apic_runtime.quota_evaluations where environment = 'test';
create or replace view apic_audit.live_audit_events with (security_invoker = true) as
select * from apic_audit.audit_events where environment = 'live';
create or replace view apic_audit.test_audit_events with (security_invoker = true) as
select * from apic_audit.audit_events where environment = 'test';

revoke all on apic_runtime.live_usage_rollups from public;
revoke all on apic_runtime.test_usage_rollups from public;
revoke all on apic_runtime.live_quota_evaluations from public;
revoke all on apic_runtime.test_quota_evaluations from public;
revoke all on apic_audit.live_audit_events from public;
revoke all on apic_audit.test_audit_events from public;

comment on column apic_runtime.usage_rollups.environment is 'Required runtime environment. No default; writers must provide test or live.';
comment on column apic_runtime.quota_evaluations.environment is 'Required runtime environment for quota decisions. No default.';
comment on column apic_audit.audit_events.environment is 'Required runtime environment for durable audit and compliance export queries. No default.';
comment on table apic_governance.promotion_evidence_bundles is 'Durable promotion/compliance evidence snapshots keyed by service and source/target environment. Store evidence metadata, not secrets.';
comment on table apic_catalog.shared_service_runtime_routes is 'Environment-scoped shared-service runtime routing targets. Secret material stays in Secret Manager.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'api_center_app') then
    execute 'grant usage on schema apic_catalog, apic_governance, apic_runtime, apic_audit to api_center_app';
    execute 'grant select, insert, update, delete on all tables in schema apic_catalog, apic_governance, apic_runtime, apic_audit to api_center_app';
    execute 'grant select on apic_runtime.live_usage_rollups, apic_runtime.test_usage_rollups, apic_runtime.live_quota_evaluations, apic_runtime.test_quota_evaluations, apic_audit.live_audit_events, apic_audit.test_audit_events to api_center_app';
  end if;
end;
$$;