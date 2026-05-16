CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS api_center;
CREATE SCHEMA IF NOT EXISTS api_center_ops;
CREATE SCHEMA IF NOT EXISTS api_center_audit;

CREATE TABLE api_center.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_center.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES api_center.organizations(id),
  service_id text NOT NULL,
  name text NOT NULL,
  service_type text NOT NULL CHECK (service_type IN ('tribe', 'shared')),
  base_url text NOT NULL,
  health_check_path text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('proposed', 'active', 'deprecated', 'retired')),
  version text,
  previous_version text,
  description text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner_team text,
  contact text,
  service_tier text CHECK (service_tier IN ('critical', 'standard', 'experimental')),
  cost_center text,
  sunset_date timestamptz,
  replacement_service_id text,
  healthy boolean,
  last_health_check_at timestamptz,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, service_id)
);

CREATE INDEX services_type_status_idx
  ON api_center.services(service_type, status);
CREATE INDEX services_owner_team_idx
  ON api_center.services(owner_team);

CREATE TABLE api_center.service_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES api_center.services(id) ON DELETE CASCADE,
  method text,
  path text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, method, path)
);

CREATE TABLE api_center.service_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES api_center.services(id) ON DELETE CASCADE,
  scope text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, scope)
);

CREATE TABLE api_center.service_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES api_center.services(id) ON DELETE CASCADE,
  depends_on_service_id uuid REFERENCES api_center.services(id),
  depends_on_external_id text,
  dependency_type text NOT NULL DEFAULT 'consumes'
    CHECK (dependency_type IN ('consumes', 'routes_to', 'shared_service', 'external')),
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (depends_on_service_id IS NOT NULL AND depends_on_external_id IS NULL)
    OR
    (depends_on_service_id IS NULL AND depends_on_external_id IS NOT NULL)
  )
);

CREATE INDEX service_dependencies_service_idx
  ON api_center.service_dependencies(service_id);
CREATE INDEX service_dependencies_depends_on_idx
  ON api_center.service_dependencies(depends_on_service_id);

CREATE TABLE api_center.service_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES api_center.services(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN (
      'registered',
      'updated',
      'deprecated',
      'retired',
      'reactivated',
      'deregistered',
      'health_changed',
      'version_changed'
    )),
  previous_status text,
  next_status text,
  previous_version text,
  next_version text,
  actor_type text NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('system', 'operator', 'tribe')),
  actor_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_center.tribe_secret_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL UNIQUE REFERENCES api_center.services(id) ON DELETE CASCADE,
  secret_manager_name text NOT NULL,
  latest_version text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'rotated', 'revoked', 'deleted')),
  rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_center.confluent_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_name text NOT NULL UNIQUE,
  owner_service_id uuid REFERENCES api_center.services(id) ON DELETE SET NULL,
  topic_type text NOT NULL
    CHECK (topic_type IN ('tribe_events', 'shared_export', 'api_center_core')),
  partitions integer NOT NULL DEFAULT 1 CHECK (partitions > 0),
  retention_ms bigint,
  cleanup_policy text NOT NULL DEFAULT 'delete',
  exists_in_confluent boolean NOT NULL DEFAULT false,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_center.s3_sink_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES api_center.confluent_topics(id) ON DELETE CASCADE,
  connector_name text NOT NULL,
  included boolean NOT NULL DEFAULT false,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (topic_id, connector_name)
);

CREATE TABLE api_center_ops.provisioning_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid REFERENCES api_center.services(id) ON DELETE SET NULL,
  job_type text NOT NULL
    CHECK (job_type IN (
      'tribe_secret',
      'confluent_topic',
      's3_sink_include',
      's3_sink_remove',
      'deployment_restart',
      'registry_sync',
      'shared_service_registration'
    )),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  requested_by text,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX provisioning_jobs_service_idx
  ON api_center_ops.provisioning_jobs(service_id);
CREATE INDEX provisioning_jobs_status_created_idx
  ON api_center_ops.provisioning_jobs(status, created_at DESC);

CREATE TABLE api_center_audit.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text,
  actor_type text NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('system', 'operator', 'tribe')),
  actor_id text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  outcome text NOT NULL DEFAULT 'succeeded'
    CHECK (outcome IN ('succeeded', 'failed', 'denied')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_created_idx
  ON api_center_audit.audit_events(created_at DESC);
CREATE INDEX audit_events_resource_idx
  ON api_center_audit.audit_events(resource_type, resource_id, created_at DESC);
CREATE INDEX audit_events_actor_idx
  ON api_center_audit.audit_events(actor_type, actor_id, created_at DESC);

CREATE TABLE api_center_ops.health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid REFERENCES api_center.services(id) ON DELETE CASCADE,
  healthy boolean NOT NULL,
  status_code integer,
  latency_ms integer,
  error_message text,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_center_ops.smoke_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid REFERENCES api_center.services(id) ON DELETE SET NULL,
  tribe_service_id uuid REFERENCES api_center.services(id) ON DELETE SET NULL,
  test_type text NOT NULL,
  provider_impacting boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('passed', 'failed', 'skipped')),
  status_code integer,
  latency_ms integer,
  response_preview text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_center_ops.usage_rollups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  consumer_service_id uuid REFERENCES api_center.services(id) ON DELETE SET NULL,
  target_service_id uuid REFERENCES api_center.services(id) ON DELETE SET NULL,
  route_family text NOT NULL CHECK (route_family IN ('tribes', 'shared', 'external', 'kafka')),
  request_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  avg_latency_ms numeric(10,2),
  p95_latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (window_start, window_end, consumer_service_id, target_service_id, route_family)
);
