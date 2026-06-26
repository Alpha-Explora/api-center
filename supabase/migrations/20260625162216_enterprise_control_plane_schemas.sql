create extension if not exists pgcrypto;

create schema if not exists apic_catalog;
create schema if not exists apic_governance;
create schema if not exists apic_runtime;
create schema if not exists apic_audit;

create schema if not exists api_center;
create schema if not exists api_center_ops;
create schema if not exists api_center_audit;

do $$
declare
  conflict_count integer;
begin
  with table_map(source_schema, source_table, target_schema, target_table) as (
    values
      ('api_center', 'organizations', 'apic_catalog', 'organizations'),
      ('api_center', 'services', 'apic_catalog', 'services'),
      ('api_center', 'service_environments', 'apic_catalog', 'service_environments'),
      ('api_center', 'service_routes', 'apic_catalog', 'service_routes'),
      ('api_center', 'service_scopes', 'apic_catalog', 'service_scopes'),
      ('api_center', 'service_dependencies', 'apic_catalog', 'service_dependencies'),
      ('api_center', 'service_lifecycle_events', 'apic_catalog', 'service_lifecycle_events'),
      ('api_center', 'tribe_secret_refs', 'apic_catalog', 'service_secret_references'),
      ('api_center_ops', 'service_registration_requests', 'apic_governance', 'registry_change_requests'),
      ('api_center_ops', 'approval_requests', 'apic_governance', 'approval_requests'),
      ('api_center_ops', 'tribe_api_quota_policies', 'apic_governance', 'quota_policies'),
      ('api_center_ops', 'tribe_plan_definitions', 'apic_governance', 'entitlement_plans'),
      ('api_center_ops', 'tribe_plan_assignments', 'apic_governance', 'entitlement_assignments'),
      ('api_center_ops', 'provisioning_jobs', 'apic_runtime', 'provisioning_jobs'),
      ('api_center_ops', 'topic_onboarding_states', 'apic_runtime', 'event_topic_onboarding_states'),
      ('api_center', 'confluent_topics', 'apic_runtime', 'confluent_topics'),
      ('api_center', 's3_sink_topics', 'apic_runtime', 's3_sink_topics'),
      ('api_center_ops', 'health_snapshots', 'apic_runtime', 'health_snapshots'),
      ('api_center_ops', 'smoke_test_runs', 'apic_runtime', 'smoke_test_runs'),
      ('api_center_ops', 'usage_rollups', 'apic_runtime', 'usage_rollups'),
      ('api_center_ops', 'tribe_api_quota_decisions', 'apic_runtime', 'quota_evaluations'),
      ('api_center_ops', 'pipeline_feedback_actions', 'apic_runtime', 'pipeline_feedback_actions'),
      ('api_center_audit', 'audit_events', 'apic_audit', 'audit_events')
  )
  select count(*) into conflict_count
  from table_map
  where to_regclass(format('%I.%I', source_schema, source_table)) is not null
    and to_regclass(format('%I.%I', target_schema, target_table)) is not null;

  if conflict_count > 0 then
    raise exception 'Enterprise schema migration conflict: % source and target table pair(s) both exist. Merge/backfill before applying.', conflict_count;
  end if;
end $$;

do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('api_center', 'organizations', 'apic_catalog', 'organizations'),
      ('api_center', 'services', 'apic_catalog', 'services'),
      ('api_center', 'service_environments', 'apic_catalog', 'service_environments'),
      ('api_center', 'service_routes', 'apic_catalog', 'service_routes'),
      ('api_center', 'service_scopes', 'apic_catalog', 'service_scopes'),
      ('api_center', 'service_dependencies', 'apic_catalog', 'service_dependencies'),
      ('api_center', 'service_lifecycle_events', 'apic_catalog', 'service_lifecycle_events'),
      ('api_center', 'tribe_secret_refs', 'apic_catalog', 'service_secret_references'),
      ('api_center_ops', 'service_registration_requests', 'apic_governance', 'registry_change_requests'),
      ('api_center_ops', 'approval_requests', 'apic_governance', 'approval_requests'),
      ('api_center_ops', 'tribe_api_quota_policies', 'apic_governance', 'quota_policies'),
      ('api_center_ops', 'tribe_plan_definitions', 'apic_governance', 'entitlement_plans'),
      ('api_center_ops', 'tribe_plan_assignments', 'apic_governance', 'entitlement_assignments'),
      ('api_center_ops', 'provisioning_jobs', 'apic_runtime', 'provisioning_jobs'),
      ('api_center_ops', 'topic_onboarding_states', 'apic_runtime', 'event_topic_onboarding_states'),
      ('api_center', 'confluent_topics', 'apic_runtime', 'confluent_topics'),
      ('api_center', 's3_sink_topics', 'apic_runtime', 's3_sink_topics'),
      ('api_center_ops', 'health_snapshots', 'apic_runtime', 'health_snapshots'),
      ('api_center_ops', 'smoke_test_runs', 'apic_runtime', 'smoke_test_runs'),
      ('api_center_ops', 'usage_rollups', 'apic_runtime', 'usage_rollups'),
      ('api_center_ops', 'tribe_api_quota_decisions', 'apic_runtime', 'quota_evaluations'),
      ('api_center_ops', 'pipeline_feedback_actions', 'apic_runtime', 'pipeline_feedback_actions'),
      ('api_center_audit', 'audit_events', 'apic_audit', 'audit_events')
    ) as t(source_schema, source_table, target_schema, target_table)
  loop
    if to_regclass(format('%I.%I', item.source_schema, item.source_table)) is not null
       and to_regclass(format('%I.%I', item.target_schema, item.target_table)) is null then
      execute format('alter table %I.%I set schema %I', item.source_schema, item.source_table, item.target_schema);
      if item.source_table <> item.target_table then
        execute format('alter table %I.%I rename to %I', item.target_schema, item.source_table, item.target_table);
      end if;
    end if;
  end loop;
end $$;

create table if not exists apic_catalog.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'active' constraint organizations_status_check check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apic_catalog.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apic_catalog.organizations(id),
  service_id text not null,
  name text not null,
  service_type text not null constraint services_service_type_check check (service_type in ('tribe', 'shared')),
  base_url text not null,
  health_check_path text,
  status text not null default 'active' constraint services_status_check check (status in ('proposed', 'active', 'deprecated', 'retired')),
  version text,
  previous_version text,
  description text,
  tags jsonb not null default '[]'::jsonb,
  owner_tribe_id text,
  owner_team text,
  contact text,
  service_tier text constraint services_service_tier_check check (service_tier is null or service_tier in ('critical', 'standard', 'experimental')),
  cost_center text,
  sunset_date timestamptz,
  replacement_service_id text,
  healthy boolean,
  last_health_check_at timestamptz,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_service_id unique (organization_id, service_id)
);

create table if not exists apic_catalog.service_environments (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references apic_catalog.services(id) on delete cascade,
  environment text not null,
  base_url text not null,
  health_check_path text,
  status text not null default 'active' constraint service_environments_status_check check (status in ('proposed', 'active', 'deprecated', 'retired')),
  healthy boolean,
  last_health_check_at timestamptz,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_environment_unique unique (service_id, environment)
);

create table if not exists apic_catalog.service_routes (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references apic_catalog.services(id) on delete cascade,
  method text,
  path text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (service_id, method, path)
);

create table if not exists apic_catalog.service_scopes (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references apic_catalog.services(id) on delete cascade,
  scope text not null,
  created_at timestamptz not null default now(),
  unique (service_id, scope)
);

create table if not exists apic_catalog.service_dependencies (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references apic_catalog.services(id) on delete cascade,
  depends_on_service_id uuid references apic_catalog.services(id),
  depends_on_external_id text,
  dependency_type text not null default 'consumes' constraint service_dependencies_dependency_type_check check (dependency_type in ('consumes', 'routes_to', 'shared_service', 'external')),
  required boolean not null default true,
  created_at timestamptz not null default now(),
  constraint service_dependencies_one_target_check check ((depends_on_service_id is not null and depends_on_external_id is null) or (depends_on_service_id is null and depends_on_external_id is not null))
);

create table if not exists apic_catalog.service_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references apic_catalog.services(id) on delete cascade,
  event_type text not null constraint service_lifecycle_events_event_type_check check (event_type in ('registered', 'updated', 'deprecated', 'retired', 'reactivated', 'deregistered', 'health_changed', 'version_changed')),
  previous_status text,
  next_status text,
  previous_version text,
  next_version text,
  actor_type text not null default 'system' constraint service_lifecycle_events_actor_type_check check (actor_type in ('system', 'operator', 'tribe')),
  actor_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists apic_catalog.service_secret_references (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null unique references apic_catalog.services(id) on delete cascade,
  secret_manager_name text not null,
  latest_version text,
  status text not null default 'active' constraint service_secret_references_status_check check (status in ('active', 'rotated', 'revoked', 'deleted')),
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apic_governance.registry_change_requests (
  id uuid primary key default gen_random_uuid(),
  service_id text not null,
  owner_tribe_id text not null,
  status text not null default 'pending' constraint registry_change_requests_status_check check (status in ('pending', 'approved', 'rejected', 'applied')),
  manifest jsonb not null,
  validation_report jsonb not null default '{}'::jsonb,
  requested_by text,
  approved_by text,
  rejected_by text,
  rejection_reason text,
  applied_service_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  applied_at timestamptz
);

create table if not exists apic_governance.approval_requests (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  target_id text,
  target_environment text not null,
  status text not null default 'pending' constraint approval_requests_status_check check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  before jsonb not null,
  after jsonb not null,
  risk_level text not null constraint approval_requests_risk_level_check check (risk_level in ('low', 'medium', 'high', 'critical')),
  reason text not null,
  requested_by text not null,
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apic_governance.quota_policies (
  id uuid primary key default gen_random_uuid(),
  owner_tribe_id text not null,
  scope text not null default 'all',
  target_service_id text,
  window_seconds integer not null constraint quota_policies_window_seconds_check check (window_seconds > 0),
  max_requests integer not null constraint quota_policies_max_requests_check check (max_requests > 0),
  burst_requests integer constraint quota_policies_burst_requests_check check (burst_requests is null or burst_requests >= 0),
  mode text not null default 'observe' constraint quota_policies_mode_check check (mode in ('observe', 'enforce')),
  status text not null default 'active' constraint quota_policies_status_check check (status in ('active', 'disabled', 'archived')),
  reason text not null,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apic_governance.entitlement_plans (
  plan_key text primary key,
  display_name text not null,
  gateway_calls_per_day integer,
  kafka_publishes_per_day integer,
  retention_tier text not null,
  shared_service_access text not null,
  support_tier text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apic_governance.entitlement_assignments (
  id uuid primary key default gen_random_uuid(),
  owner_tribe_id text not null,
  plan_key text not null references apic_governance.entitlement_plans(plan_key),
  environment text not null,
  status text not null default 'active' constraint entitlement_assignments_status_check check (status in ('active', 'suspended', 'archived')),
  effective_at timestamptz not null,
  reason text not null,
  assigned_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apic_runtime.provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references apic_catalog.services(id) on delete set null,
  job_type text not null constraint provisioning_jobs_job_type_check check (job_type in ('tribe_secret', 'confluent_topic', 's3_sink_include', 's3_sink_remove', 'deployment_restart', 'registry_sync', 'shared_service_registration')),
  status text not null default 'pending' constraint provisioning_jobs_status_check check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  requested_by text,
  request jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apic_runtime.event_topic_onboarding_states (
  physical_topic text primary key,
  environment text not null,
  owner_tribe_id text,
  record jsonb not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apic_runtime.confluent_topics (
  id uuid primary key default gen_random_uuid(),
  topic_name text not null unique,
  owner_service_id uuid references apic_catalog.services(id) on delete set null,
  topic_type text not null constraint confluent_topics_topic_type_check check (topic_type in ('tribe_events', 'shared_export', 'api_center_core')),
  partitions integer not null default 1 constraint confluent_topics_partitions_check check (partitions > 0),
  retention_ms bigint,
  cleanup_policy text not null default 'delete',
  exists_in_confluent boolean not null default false,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apic_runtime.s3_sink_topics (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references apic_runtime.confluent_topics(id) on delete cascade,
  connector_name text not null,
  included boolean not null default false,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic_id, connector_name)
);

create table if not exists apic_runtime.health_snapshots (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references apic_catalog.services(id) on delete cascade,
  healthy boolean not null,
  status_code integer,
  latency_ms integer,
  error_message text,
  checked_at timestamptz not null default now()
);

create table if not exists apic_runtime.smoke_test_runs (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references apic_catalog.services(id) on delete set null,
  tribe_service_id uuid references apic_catalog.services(id) on delete set null,
  test_type text not null,
  provider_impacting boolean not null default false,
  status text not null constraint smoke_test_runs_status_check check (status in ('passed', 'failed', 'skipped')),
  status_code integer,
  latency_ms integer,
  response_preview text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists apic_runtime.usage_rollups (
  id uuid primary key default gen_random_uuid(),
  window_start timestamptz not null,
  window_end timestamptz not null,
  consumer_service_id uuid references apic_catalog.services(id) on delete set null,
  target_service_id uuid references apic_catalog.services(id) on delete set null,
  route_family text not null constraint usage_rollups_route_family_check check (route_family in ('tribes', 'shared', 'external', 'kafka')),
  request_count integer not null default 0,
  success_count integer not null default 0,
  error_count integer not null default 0,
  avg_latency_ms numeric(10,2),
  p95_latency_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (window_start, window_end, consumer_service_id, target_service_id, route_family)
);

create table if not exists apic_runtime.quota_evaluations (
  id uuid primary key default gen_random_uuid(),
  owner_tribe_id text not null,
  policy_id uuid,
  scope text not null,
  target_service_id text,
  route_family text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  request_count integer not null,
  max_requests integer not null,
  mode text not null constraint quota_evaluations_mode_check check (mode in ('observe', 'enforce')),
  outcome text not null constraint quota_evaluations_outcome_check check (outcome in ('allowed', 'observed_exceeded', 'blocked')),
  correlation_id text,
  created_at timestamptz not null default now()
);

create table if not exists apic_runtime.pipeline_feedback_actions (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  environment text not null,
  target_type text not null,
  target_id text not null,
  owner_tribe_id text,
  evidence_link text,
  reason text not null,
  actor_id text not null,
  actor_role text not null,
  correlation_id text,
  status text not null default 'pending' constraint pipeline_feedback_actions_status_check check (status in ('pending', 'reviewed', 'blocking', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists apic_audit.audit_events (
  id uuid primary key default gen_random_uuid(),
  correlation_id text,
  actor_type text not null default 'system' constraint audit_events_actor_type_check check (actor_type in ('system', 'operator', 'tribe', 'human', 'service')),
  actor_id text,
  action text not null,
  resource_type text not null,
  resource_id text,
  outcome text not null default 'succeeded' constraint audit_events_outcome_check check (outcome in ('succeeded', 'failed', 'denied')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists services_type_status_idx on apic_catalog.services(service_type, status);
create index if not exists services_owner_tribe_idx on apic_catalog.services(owner_tribe_id);
create index if not exists services_org_owner_type_status_idx on apic_catalog.services(organization_id, owner_tribe_id, service_type, status);
create index if not exists services_owner_team_idx on apic_catalog.services(owner_team);
create index if not exists service_environments_service_id_idx on apic_catalog.service_environments(service_id);
create index if not exists service_environments_env_status_idx on apic_catalog.service_environments(environment, status);
create index if not exists service_dependencies_service_idx on apic_catalog.service_dependencies(service_id);
create index if not exists service_dependencies_depends_on_idx on apic_catalog.service_dependencies(depends_on_service_id);
create index if not exists service_lifecycle_events_service_idx on apic_catalog.service_lifecycle_events(service_id);
create index if not exists registry_change_requests_status_created_idx on apic_governance.registry_change_requests(status, created_at desc);
create index if not exists registry_change_requests_service_idx on apic_governance.registry_change_requests(service_id);
create index if not exists registry_change_requests_owner_idx on apic_governance.registry_change_requests(owner_tribe_id);
create index if not exists approval_requests_status_created_idx on apic_governance.approval_requests(status, created_at desc);
create index if not exists approval_requests_action_env_idx on apic_governance.approval_requests(action_type, target_environment);
create index if not exists approval_requests_target_idx on apic_governance.approval_requests(target_id);
create index if not exists quota_policies_owner_status_idx on apic_governance.quota_policies(owner_tribe_id, status);
create index if not exists quota_policies_scope_target_idx on apic_governance.quota_policies(scope, target_service_id);
create index if not exists entitlement_assignments_owner_env_status_idx on apic_governance.entitlement_assignments(owner_tribe_id, environment, status);
create index if not exists entitlement_assignments_plan_env_idx on apic_governance.entitlement_assignments(plan_key, environment);
create index if not exists provisioning_jobs_service_idx on apic_runtime.provisioning_jobs(service_id);
create index if not exists provisioning_jobs_status_created_idx on apic_runtime.provisioning_jobs(status, created_at desc);
create index if not exists confluent_topics_owner_service_idx on apic_runtime.confluent_topics(owner_service_id);
create index if not exists health_snapshots_service_idx on apic_runtime.health_snapshots(service_id);
create index if not exists smoke_test_runs_service_idx on apic_runtime.smoke_test_runs(service_id);
create index if not exists smoke_test_runs_tribe_service_idx on apic_runtime.smoke_test_runs(tribe_service_id);
create index if not exists usage_rollups_consumer_service_idx on apic_runtime.usage_rollups(consumer_service_id);
create index if not exists usage_rollups_target_service_idx on apic_runtime.usage_rollups(target_service_id);
create index if not exists event_topic_onboarding_states_env_owner_idx on apic_runtime.event_topic_onboarding_states(environment, owner_tribe_id);
create index if not exists event_topic_onboarding_states_updated_idx on apic_runtime.event_topic_onboarding_states(updated_at);
create index if not exists quota_evaluations_owner_created_idx on apic_runtime.quota_evaluations(owner_tribe_id, created_at desc);
create index if not exists quota_evaluations_outcome_created_idx on apic_runtime.quota_evaluations(outcome, created_at desc);
create index if not exists quota_evaluations_correlation_idx on apic_runtime.quota_evaluations(correlation_id);
create index if not exists pipeline_feedback_actions_env_target_idx on apic_runtime.pipeline_feedback_actions(environment, target_id, created_at desc);
create index if not exists pipeline_feedback_actions_status_created_idx on apic_runtime.pipeline_feedback_actions(status, created_at desc);
create index if not exists pipeline_feedback_actions_owner_idx on apic_runtime.pipeline_feedback_actions(owner_tribe_id, created_at desc);
create index if not exists pipeline_feedback_actions_correlation_idx on apic_runtime.pipeline_feedback_actions(correlation_id);
create index if not exists audit_events_created_idx on apic_audit.audit_events(created_at desc);
create index if not exists audit_events_resource_idx on apic_audit.audit_events(resource_type, resource_id, created_at desc);
create index if not exists audit_events_actor_idx on apic_audit.audit_events(actor_type, actor_id, created_at desc);

do $$
begin
  if to_regclass('apic_governance.service_registration_requests_status_created_idx') is not null and to_regclass('apic_governance.registry_change_requests_status_created_idx') is null then alter index apic_governance.service_registration_requests_status_created_idx rename to registry_change_requests_status_created_idx; end if;
  if to_regclass('apic_governance.service_registration_requests_service_idx') is not null and to_regclass('apic_governance.registry_change_requests_service_idx') is null then alter index apic_governance.service_registration_requests_service_idx rename to registry_change_requests_service_idx; end if;
  if to_regclass('apic_governance.service_registration_requests_owner_idx') is not null and to_regclass('apic_governance.registry_change_requests_owner_idx') is null then alter index apic_governance.service_registration_requests_owner_idx rename to registry_change_requests_owner_idx; end if;
  if to_regclass('apic_governance.tribe_quota_policies_owner_status_idx') is not null and to_regclass('apic_governance.quota_policies_owner_status_idx') is null then alter index apic_governance.tribe_quota_policies_owner_status_idx rename to quota_policies_owner_status_idx; end if;
  if to_regclass('apic_governance.tribe_quota_policies_scope_target_idx') is not null and to_regclass('apic_governance.quota_policies_scope_target_idx') is null then alter index apic_governance.tribe_quota_policies_scope_target_idx rename to quota_policies_scope_target_idx; end if;
  if to_regclass('apic_governance.tribe_plan_assignments_owner_env_status_idx') is not null and to_regclass('apic_governance.entitlement_assignments_owner_env_status_idx') is null then alter index apic_governance.tribe_plan_assignments_owner_env_status_idx rename to entitlement_assignments_owner_env_status_idx; end if;
  if to_regclass('apic_governance.tribe_plan_assignments_plan_env_idx') is not null and to_regclass('apic_governance.entitlement_assignments_plan_env_idx') is null then alter index apic_governance.tribe_plan_assignments_plan_env_idx rename to entitlement_assignments_plan_env_idx; end if;
  if to_regclass('apic_runtime.topic_onboarding_states_env_owner_idx') is not null and to_regclass('apic_runtime.event_topic_onboarding_states_env_owner_idx') is null then alter index apic_runtime.topic_onboarding_states_env_owner_idx rename to event_topic_onboarding_states_env_owner_idx; end if;
  if to_regclass('apic_runtime.topic_onboarding_states_updated_idx') is not null and to_regclass('apic_runtime.event_topic_onboarding_states_updated_idx') is null then alter index apic_runtime.topic_onboarding_states_updated_idx rename to event_topic_onboarding_states_updated_idx; end if;
  if to_regclass('apic_runtime.tribe_quota_decisions_owner_created_idx') is not null and to_regclass('apic_runtime.quota_evaluations_owner_created_idx') is null then alter index apic_runtime.tribe_quota_decisions_owner_created_idx rename to quota_evaluations_owner_created_idx; end if;
  if to_regclass('apic_runtime.tribe_quota_decisions_outcome_created_idx') is not null and to_regclass('apic_runtime.quota_evaluations_outcome_created_idx') is null then alter index apic_runtime.tribe_quota_decisions_outcome_created_idx rename to quota_evaluations_outcome_created_idx; end if;
  if to_regclass('apic_runtime.tribe_quota_decisions_correlation_idx') is not null and to_regclass('apic_runtime.quota_evaluations_correlation_idx') is null then alter index apic_runtime.tribe_quota_decisions_correlation_idx rename to quota_evaluations_correlation_idx; end if;
end $$;

do $$
begin
  if exists (select 1 from pg_constraint c join pg_class r on r.oid = c.conrelid join pg_namespace n on n.oid = r.relnamespace where n.nspname = 'apic_governance' and r.relname = 'registry_change_requests' and c.conname = 'service_registration_requests_status_check')
     and not exists (select 1 from pg_constraint c join pg_class r on r.oid = c.conrelid join pg_namespace n on n.oid = r.relnamespace where n.nspname = 'apic_governance' and r.relname = 'registry_change_requests' and c.conname = 'registry_change_requests_status_check') then
    alter table apic_governance.registry_change_requests rename constraint service_registration_requests_status_check to registry_change_requests_status_check;
  end if;
end $$;

create or replace view api_center.organizations with (security_invoker = true) as select * from apic_catalog.organizations;
create or replace view api_center.services with (security_invoker = true) as select * from apic_catalog.services;
create or replace view api_center.service_environments with (security_invoker = true) as select * from apic_catalog.service_environments;
create or replace view api_center.service_routes with (security_invoker = true) as select * from apic_catalog.service_routes;
create or replace view api_center.service_scopes with (security_invoker = true) as select * from apic_catalog.service_scopes;
create or replace view api_center.service_dependencies with (security_invoker = true) as select * from apic_catalog.service_dependencies;
create or replace view api_center.service_lifecycle_events with (security_invoker = true) as select * from apic_catalog.service_lifecycle_events;
create or replace view api_center.tribe_secret_refs with (security_invoker = true) as select * from apic_catalog.service_secret_references;
create or replace view api_center.confluent_topics with (security_invoker = true) as select * from apic_runtime.confluent_topics;
create or replace view api_center.s3_sink_topics with (security_invoker = true) as select * from apic_runtime.s3_sink_topics;
create or replace view api_center_ops.service_registration_requests with (security_invoker = true) as select * from apic_governance.registry_change_requests;
create or replace view api_center_ops.approval_requests with (security_invoker = true) as select * from apic_governance.approval_requests;
create or replace view api_center_ops.tribe_api_quota_policies with (security_invoker = true) as select * from apic_governance.quota_policies;
create or replace view api_center_ops.tribe_plan_definitions with (security_invoker = true) as select * from apic_governance.entitlement_plans;
create or replace view api_center_ops.tribe_plan_assignments with (security_invoker = true) as select * from apic_governance.entitlement_assignments;
create or replace view api_center_ops.provisioning_jobs with (security_invoker = true) as select * from apic_runtime.provisioning_jobs;
create or replace view api_center_ops.topic_onboarding_states with (security_invoker = true) as select * from apic_runtime.event_topic_onboarding_states;
create or replace view api_center_ops.health_snapshots with (security_invoker = true) as select * from apic_runtime.health_snapshots;
create or replace view api_center_ops.smoke_test_runs with (security_invoker = true) as select * from apic_runtime.smoke_test_runs;
create or replace view api_center_ops.usage_rollups with (security_invoker = true) as select * from apic_runtime.usage_rollups;
create or replace view api_center_ops.tribe_api_quota_decisions with (security_invoker = true) as select * from apic_runtime.quota_evaluations;
create or replace view api_center_ops.pipeline_feedback_actions with (security_invoker = true) as select * from apic_runtime.pipeline_feedback_actions;
create or replace view api_center_audit.audit_events with (security_invoker = true) as select * from apic_audit.audit_events;

comment on table apic_audit.audit_events is 'retention=400d; partition=monthly_required_before_audit_ready; exception=requires_written_approval';
comment on table apic_runtime.quota_evaluations is 'retention=180d; partition=monthly_required_before_high_volume_enforcement; exception=observe_mode_low_volume';
comment on table apic_runtime.usage_rollups is 'retention=400d; partition=monthly_or_rollup_only; raw_request_storage=forbidden';
comment on table apic_runtime.health_snapshots is 'retention=90d; partition=row_count_threshold_1000000_per_90d';
comment on table apic_runtime.smoke_test_runs is 'retention=180d; partition=row_count_threshold_1000000_per_180d';
comment on table apic_runtime.pipeline_feedback_actions is 'retention=365d; partition=row_count_threshold_100000_per_month';

revoke all on schema apic_catalog, apic_governance, apic_runtime, apic_audit from public;
revoke all on all tables in schema apic_catalog from public;
revoke all on all tables in schema apic_governance from public;
revoke all on all tables in schema apic_runtime from public;
revoke all on all tables in schema apic_audit from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'api_center_app') then
    raise exception 'Required runtime database role api_center_app is missing. Confirm Task 1 role discovery and update grants before live approval.';
  end if;
end $$;

grant usage on schema apic_catalog, apic_governance, apic_runtime, apic_audit to api_center_app;
grant select, insert, update on all tables in schema apic_catalog to api_center_app;
grant select, insert, update on all tables in schema apic_governance to api_center_app;
grant select, insert, update on all tables in schema apic_runtime to api_center_app;
grant select, insert on apic_audit.audit_events to api_center_app;
revoke delete on all tables in schema apic_audit from api_center_app;
alter default privileges in schema apic_catalog grant select, insert, update on tables to api_center_app;
alter default privileges in schema apic_governance grant select, insert, update on tables to api_center_app;
alter default privileges in schema apic_runtime grant select, insert, update on tables to api_center_app;
alter default privileges in schema apic_audit grant select, insert on tables to api_center_app;

grant usage on schema api_center, api_center_ops, api_center_audit to api_center_app;
grant select, insert, update on all tables in schema api_center to api_center_app;
grant select, insert, update on all tables in schema api_center_ops to api_center_app;
grant select, insert on all tables in schema api_center_audit to api_center_app;

