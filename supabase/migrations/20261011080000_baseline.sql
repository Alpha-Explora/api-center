-- APICenter migration baseline.
-- Replaces the 47-file migration history present on 2026-10-10.
-- Produced by replaying that chain into an empty database, then running pg_dump 17.11
-- with --schema-only --no-owner over the guarded APIC schemas. ACLs/default privileges
-- are retained. The chain also creates pgcrypto in public, included below.
-- Existing databases must reset or repair Supabase migration history before db push.

DO $baseline_roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'api_center_retention') THEN
    CREATE ROLE api_center_retention NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'payments_runtime') THEN
    CREATE ROLE payments_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'email_runtime') THEN
    CREATE ROLE email_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sms_runtime') THEN
    CREATE ROLE sms_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'otp_runtime') THEN
    CREATE ROLE otp_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gauth_runtime') THEN
    CREATE ROLE gauth_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'api_center_app') THEN
    CREATE ROLE api_center_app NOLOGIN;
  END IF;
END
$baseline_roles$;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- The replayed chain has no memberships for the application roles above.
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11


--
-- Name: apic_audit; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA apic_audit;


--
-- Name: apic_catalog; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA apic_catalog;


--
-- Name: apic_governance; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA apic_governance;


--
-- Name: apic_runtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA apic_runtime;


--
-- Name: shared_email; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA shared_email;


--
-- Name: shared_gauth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA shared_gauth;


--
-- Name: shared_otp; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA shared_otp;


--
-- Name: shared_payment; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA shared_payment;


--
-- Name: shared_sms; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA shared_sms;




--
-- Name: audit_events; Type: TABLE; Schema: apic_audit; Owner: -
--

CREATE TABLE apic_audit.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    correlation_id text,
    actor_type text DEFAULT 'system'::text NOT NULL,
    actor_id text,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id text,
    outcome text DEFAULT 'succeeded'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    environment text NOT NULL,
    source_service_id text,
    service_id text,
    tribe_id text,
    CONSTRAINT audit_events_actor_type_check CHECK ((actor_type = ANY (ARRAY['system'::text, 'operator'::text, 'tribe'::text]))),
    CONSTRAINT audit_events_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
    CONSTRAINT audit_events_outcome_check CHECK ((outcome = ANY (ARRAY['succeeded'::text, 'failed'::text, 'denied'::text])))
);


--
-- Name: TABLE audit_events; Type: COMMENT; Schema: apic_audit; Owner: -
--

COMMENT ON TABLE apic_audit.audit_events IS 'retention=400d; partition=monthly_required_before_audit_ready; exception=requires_written_approval';


--
-- Name: COLUMN audit_events.environment; Type: COMMENT; Schema: apic_audit; Owner: -
--

COMMENT ON COLUMN apic_audit.audit_events.environment IS 'Required runtime environment for durable audit and compliance export queries. No default.';


--
-- Name: live_audit_events; Type: VIEW; Schema: apic_audit; Owner: -
--

CREATE VIEW apic_audit.live_audit_events WITH (security_invoker='true') AS
 SELECT id,
    correlation_id,
    actor_type,
    actor_id,
    action,
    resource_type,
    resource_id,
    outcome,
    metadata,
    created_at,
    environment,
    source_service_id,
    service_id,
    tribe_id
   FROM apic_audit.audit_events
  WHERE (environment = 'live'::text);


--
-- Name: test_audit_events; Type: VIEW; Schema: apic_audit; Owner: -
--

CREATE VIEW apic_audit.test_audit_events WITH (security_invoker='true') AS
 SELECT id,
    correlation_id,
    actor_type,
    actor_id,
    action,
    resource_type,
    resource_id,
    outcome,
    metadata,
    created_at,
    environment,
    source_service_id,
    service_id,
    tribe_id
   FROM apic_audit.audit_events
  WHERE (environment = 'test'::text);


--
-- Name: organization_members; Type: TABLE; Schema: apic_catalog; Owner: -
--

CREATE TABLE apic_catalog.organization_members (
    organization_id uuid NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_members_email_check CHECK (((email = lower(email)) AND ((length(email) >= 3) AND (length(email) <= 320)))),
    CONSTRAINT organization_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'operator'::text, 'observer'::text])))
);


--
-- Name: organizations; Type: TABLE; Schema: apic_catalog; Owner: -
--

CREATE TABLE apic_catalog.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organizations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'archived'::text])))
);


--
-- Name: projects; Type: TABLE; Schema: apic_catalog; Owner: -
--

CREATE TABLE apic_catalog.projects (
    project_id text NOT NULL,
    tribe_id text NOT NULL,
    name text NOT NULL,
    description text,
    cost_center text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT projects_project_id_check CHECK ((project_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'::text)),
    CONSTRAINT projects_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'archived'::text])))
);


--
-- Name: service_dependencies; Type: TABLE; Schema: apic_catalog; Owner: -
--

CREATE TABLE apic_catalog.service_dependencies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    depends_on_service_id uuid,
    depends_on_external_id text,
    dependency_type text DEFAULT 'consumes'::text NOT NULL,
    required boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_dependencies_check CHECK ((((depends_on_service_id IS NOT NULL) AND (depends_on_external_id IS NULL)) OR ((depends_on_service_id IS NULL) AND (depends_on_external_id IS NOT NULL)))),
    CONSTRAINT service_dependencies_dependency_type_check CHECK ((dependency_type = ANY (ARRAY['consumes'::text, 'routes_to'::text, 'shared_service'::text, 'external'::text])))
);


--
-- Name: service_environments; Type: TABLE; Schema: apic_catalog; Owner: -
--

CREATE TABLE apic_catalog.service_environments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    environment text NOT NULL,
    base_url text NOT NULL,
    health_check_path text,
    status text DEFAULT 'active'::text NOT NULL,
    healthy boolean,
    last_health_check_at timestamp with time zone,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_environments_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'active'::text, 'deprecated'::text, 'retired'::text])))
);


--
-- Name: service_lifecycle_events; Type: TABLE; Schema: apic_catalog; Owner: -
--

CREATE TABLE apic_catalog.service_lifecycle_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    event_type text NOT NULL,
    previous_status text,
    next_status text,
    previous_version text,
    next_version text,
    actor_type text DEFAULT 'system'::text NOT NULL,
    actor_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_lifecycle_events_actor_type_check CHECK ((actor_type = ANY (ARRAY['system'::text, 'operator'::text, 'tribe'::text]))),
    CONSTRAINT service_lifecycle_events_event_type_check CHECK ((event_type = ANY (ARRAY['registered'::text, 'updated'::text, 'deprecated'::text, 'retired'::text, 'reactivated'::text, 'deregistered'::text, 'health_changed'::text, 'version_changed'::text])))
);


--
-- Name: service_routes; Type: TABLE; Schema: apic_catalog; Owner: -
--

CREATE TABLE apic_catalog.service_routes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    method text,
    path text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_scopes; Type: TABLE; Schema: apic_catalog; Owner: -
--

CREATE TABLE apic_catalog.service_scopes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    scope text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_spec_versions; Type: TABLE; Schema: apic_catalog; Owner: -
--

CREATE TABLE apic_catalog.service_spec_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    version text NOT NULL,
    format text NOT NULL,
    document jsonb NOT NULL,
    sha256 character(64) NOT NULL,
    published_by text NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_spec_versions_document_check CHECK ((jsonb_typeof(document) = 'object'::text)),
    CONSTRAINT service_spec_versions_format_check CHECK ((format = ANY (ARRAY['openapi-3.0'::text, 'openapi-3.1'::text, 'asyncapi-2'::text, 'asyncapi-3'::text]))),
    CONSTRAINT service_spec_versions_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT service_spec_versions_version_check CHECK (((length(version) >= 1) AND (length(version) <= 128)))
);


--
-- Name: services; Type: TABLE; Schema: apic_catalog; Owner: -
--

CREATE TABLE apic_catalog.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    service_id text NOT NULL,
    name text NOT NULL,
    service_type text NOT NULL,
    base_url text NOT NULL,
    health_check_path text,
    status text DEFAULT 'active'::text NOT NULL,
    version text,
    previous_version text,
    description text,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    owner_team text,
    contact text,
    service_tier text,
    cost_center text,
    sunset_date timestamp with time zone,
    replacement_service_id text,
    healthy boolean,
    last_health_check_at timestamp with time zone,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_tribe_id text,
    project_id text,
    CONSTRAINT services_project_placement_check CHECK ((((service_type = 'tribe'::text) AND (project_id IS NOT NULL) AND (owner_tribe_id IS NOT NULL)) OR ((service_type = 'shared'::text) AND (project_id IS NULL) AND (owner_tribe_id IS NULL)))),
    CONSTRAINT services_service_tier_check CHECK ((service_tier = ANY (ARRAY['critical'::text, 'standard'::text, 'experimental'::text]))),
    CONSTRAINT services_service_type_check CHECK ((service_type = ANY (ARRAY['tribe'::text, 'shared'::text]))),
    CONSTRAINT services_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'active'::text, 'deprecated'::text, 'retired'::text])))
);


--
-- Name: tribes; Type: TABLE; Schema: apic_catalog; Owner: -
--

CREATE TABLE apic_catalog.tribes (
    tribe_id text NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tribes_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'archived'::text]))),
    CONSTRAINT tribes_tribe_id_check CHECK ((tribe_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'::text))
);


--
-- Name: api_subscriptions; Type: TABLE; Schema: apic_governance; Owner: -
--

CREATE TABLE apic_governance.api_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consumer_project_id text NOT NULL,
    api_project_id text NOT NULL,
    api_service_id text NOT NULL,
    environment text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_by text NOT NULL,
    decided_by text,
    decided_at timestamp with time zone,
    reason text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT api_subscriptions_decision_metadata_check CHECK ((((status = 'pending'::text) AND (decided_by IS NULL) AND (decided_at IS NULL)) OR ((status <> 'pending'::text) AND (decided_by IS NOT NULL) AND (decided_at IS NOT NULL)))),
    CONSTRAINT api_subscriptions_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
    CONSTRAINT api_subscriptions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'revoked'::text])))
);


--
-- Name: approval_requests; Type: TABLE; Schema: apic_governance; Owner: -
--

CREATE TABLE apic_governance.approval_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action_type text NOT NULL,
    target_id text,
    target_environment text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    before jsonb NOT NULL,
    after jsonb NOT NULL,
    risk_level text NOT NULL,
    reason text NOT NULL,
    requested_by text NOT NULL,
    approved_by text,
    approved_at timestamp with time zone,
    rejected_by text,
    rejected_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_at timestamp with time zone,
    cancelled_by text,
    cancelled_at timestamp with time zone,
    CONSTRAINT approval_requests_action_type_check CHECK ((action_type = ANY (ARRAY['quota.enforce'::text, 'secret.rotate'::text, 'topic.provision'::text, 's3_sink.include_topic'::text, 'service.register_live'::text, 'service.retire'::text, 'plan.assign_live'::text]))),
    CONSTRAINT approval_requests_risk_level_check CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT approval_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text, 'applied'::text])))
);


--
-- Name: entitlement_assignments; Type: TABLE; Schema: apic_governance; Owner: -
--

CREATE TABLE apic_governance.entitlement_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_tribe_id text NOT NULL,
    plan_key text NOT NULL,
    environment text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    reason text NOT NULL,
    assigned_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id text NOT NULL,
    CONSTRAINT entitlement_assignments_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
    CONSTRAINT entitlement_assignments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'archived'::text])))
);


--
-- Name: payment_api_keys; Type: TABLE; Schema: apic_governance; Owner: -
--

CREATE TABLE apic_governance.payment_api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consumer_service_id uuid NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    scopes text[] DEFAULT ARRAY['payments:read'::text, 'payments:write'::text] NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: payment_consumer_services; Type: TABLE; Schema: apic_governance; Owner: -
--

CREATE TABLE apic_governance.payment_consumer_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_tribe_id text NOT NULL,
    consumer_service_id text NOT NULL,
    environment text NOT NULL,
    event_endpoint_url text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_consumer_services_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
    CONSTRAINT payment_consumer_services_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'revoked'::text])))
);


--
-- Name: payment_limit_overrides; Type: TABLE; Schema: apic_governance; Owner: -
--

CREATE TABLE apic_governance.payment_limit_overrides (
    owner_tribe_id text NOT NULL,
    project_id text NOT NULL,
    environment text NOT NULL,
    maximum_payment_amount_minor bigint NOT NULL,
    payment_requests_per_minute integer NOT NULL,
    reason text NOT NULL,
    updated_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_limit_overrides_amount_check CHECK ((maximum_payment_amount_minor > 0)),
    CONSTRAINT payment_limit_overrides_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
    CONSTRAINT payment_limit_overrides_reason_check CHECK ((length(btrim(reason)) > 0)),
    CONSTRAINT payment_limit_overrides_requests_check CHECK ((payment_requests_per_minute > 0))
);


--
-- Name: payment_request_rate_windows; Type: TABLE; Schema: apic_governance; Owner: -
--

CREATE TABLE apic_governance.payment_request_rate_windows (
    project_id text NOT NULL,
    environment text NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    request_count integer NOT NULL,
    CONSTRAINT payment_request_rate_windows_count_check CHECK ((request_count > 0)),
    CONSTRAINT payment_request_rate_windows_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text])))
);


--
-- Name: TABLE payment_request_rate_windows; Type: COMMENT; Schema: apic_governance; Owner: -
--

COMMENT ON TABLE apic_governance.payment_request_rate_windows IS 'Bounded counter: one row per project/environment; each request atomically replaces or increments the current minute window.';


--
-- Name: quota_policies; Type: TABLE; Schema: apic_governance; Owner: -
--

CREATE TABLE apic_governance.quota_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_tribe_id text NOT NULL,
    scope text DEFAULT 'all'::text NOT NULL,
    target_service_id text,
    window_seconds integer NOT NULL,
    max_requests integer NOT NULL,
    burst_requests integer,
    mode text DEFAULT 'observe'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    reason text NOT NULL,
    created_by text,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id text,
    CONSTRAINT quota_policies_mode_check CHECK ((mode = ANY (ARRAY['observe'::text, 'enforce'::text]))),
    CONSTRAINT quota_policies_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'archived'::text]))),
    CONSTRAINT tribe_api_quota_policies_check CHECK (((burst_requests IS NULL) OR (burst_requests >= max_requests))),
    CONSTRAINT tribe_api_quota_policies_max_requests_check CHECK ((max_requests > 0)),
    CONSTRAINT tribe_api_quota_policies_scope_check CHECK ((scope = ANY (ARRAY['all'::text, 'shared'::text, 'tribe'::text, 'kafka_publish'::text]))),
    CONSTRAINT tribe_api_quota_policies_window_seconds_check CHECK ((window_seconds > 0))
);


--
-- Name: registry_change_requests; Type: TABLE; Schema: apic_governance; Owner: -
--

CREATE TABLE apic_governance.registry_change_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id text NOT NULL,
    owner_tribe_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    manifest jsonb NOT NULL,
    validation_report jsonb DEFAULT '{}'::jsonb NOT NULL,
    requested_by text,
    approved_by text,
    rejected_by text,
    rejection_reason text,
    applied_service_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    applied_at timestamp with time zone,
    project_id text,
    CONSTRAINT registry_change_requests_placement_check CHECK (((status <> 'pending'::text) OR ((COALESCE((manifest ->> 'serviceType'::text), 'tribe'::text) = 'shared'::text) AND (project_id IS NULL) AND (owner_tribe_id IS NULL)) OR ((COALESCE((manifest ->> 'serviceType'::text), 'tribe'::text) = 'tribe'::text) AND (project_id IS NOT NULL) AND (owner_tribe_id IS NOT NULL)))),
    CONSTRAINT registry_change_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'applied'::text])))
);


--
-- Name: confluent_topics; Type: TABLE; Schema: apic_runtime; Owner: -
--

CREATE TABLE apic_runtime.confluent_topics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    topic_name text NOT NULL,
    owner_service_id uuid,
    topic_type text NOT NULL,
    partitions integer DEFAULT 1 NOT NULL,
    retention_ms bigint,
    cleanup_policy text DEFAULT 'delete'::text NOT NULL,
    exists_in_confluent boolean DEFAULT false NOT NULL,
    last_checked_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT confluent_topics_partitions_check CHECK ((partitions > 0)),
    CONSTRAINT confluent_topics_topic_type_check CHECK ((topic_type = ANY (ARRAY['tribe_events'::text, 'shared_export'::text, 'api_center_core'::text])))
);


--
-- Name: event_topic_onboarding_states; Type: TABLE; Schema: apic_runtime; Owner: -
--

CREATE TABLE apic_runtime.event_topic_onboarding_states (
    physical_topic text NOT NULL,
    environment text NOT NULL,
    owner_tribe_id text,
    record jsonb NOT NULL,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: quota_evaluations; Type: TABLE; Schema: apic_runtime; Owner: -
--

CREATE TABLE apic_runtime.quota_evaluations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_tribe_id text NOT NULL,
    policy_id uuid,
    scope text NOT NULL,
    target_service_id text,
    route_family text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    request_count integer NOT NULL,
    max_requests integer NOT NULL,
    mode text NOT NULL,
    outcome text NOT NULL,
    correlation_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    environment text NOT NULL,
    project_id text,
    CONSTRAINT quota_evaluations_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
    CONSTRAINT quota_evaluations_mode_check CHECK ((mode = ANY (ARRAY['observe'::text, 'enforce'::text]))),
    CONSTRAINT quota_evaluations_outcome_check CHECK ((outcome = ANY (ARRAY['allowed'::text, 'observed_exceeded'::text, 'blocked'::text])))
);


--
-- Name: TABLE quota_evaluations; Type: COMMENT; Schema: apic_runtime; Owner: -
--

COMMENT ON TABLE apic_runtime.quota_evaluations IS 'retention=180d; partition=monthly_required_before_high_volume_enforcement; exception=observe_mode_low_volume';


--
-- Name: COLUMN quota_evaluations.environment; Type: COMMENT; Schema: apic_runtime; Owner: -
--

COMMENT ON COLUMN apic_runtime.quota_evaluations.environment IS 'Required runtime environment for quota decisions. No default.';


--
-- Name: live_quota_evaluations; Type: VIEW; Schema: apic_runtime; Owner: -
--

CREATE VIEW apic_runtime.live_quota_evaluations WITH (security_invoker='true') AS
 SELECT id,
    owner_tribe_id,
    policy_id,
    scope,
    target_service_id,
    route_family,
    window_start,
    window_end,
    request_count,
    max_requests,
    mode,
    outcome,
    correlation_id,
    created_at,
    environment
   FROM apic_runtime.quota_evaluations
  WHERE (environment = 'live'::text);


--
-- Name: usage_rollups; Type: TABLE; Schema: apic_runtime; Owner: -
--

CREATE TABLE apic_runtime.usage_rollups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    consumer_service_id uuid,
    target_service_id uuid,
    route_family text NOT NULL,
    request_count integer DEFAULT 0 NOT NULL,
    success_count integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    avg_latency_ms numeric(10,2),
    p95_latency_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    environment text NOT NULL,
    CONSTRAINT usage_rollups_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
    CONSTRAINT usage_rollups_route_family_check CHECK ((route_family = ANY (ARRAY['tribes'::text, 'shared'::text, 'external'::text, 'kafka'::text])))
);


--
-- Name: TABLE usage_rollups; Type: COMMENT; Schema: apic_runtime; Owner: -
--

COMMENT ON TABLE apic_runtime.usage_rollups IS 'retention=400d; partition=monthly_or_rollup_only; raw_request_storage=forbidden';


--
-- Name: COLUMN usage_rollups.environment; Type: COMMENT; Schema: apic_runtime; Owner: -
--

COMMENT ON COLUMN apic_runtime.usage_rollups.environment IS 'Required runtime environment. No default; writers must provide test or live.';


--
-- Name: live_usage_rollups; Type: VIEW; Schema: apic_runtime; Owner: -
--

CREATE VIEW apic_runtime.live_usage_rollups WITH (security_invoker='true') AS
 SELECT id,
    window_start,
    window_end,
    consumer_service_id,
    target_service_id,
    route_family,
    request_count,
    success_count,
    error_count,
    avg_latency_ms,
    p95_latency_ms,
    created_at,
    updated_at,
    environment
   FROM apic_runtime.usage_rollups
  WHERE (environment = 'live'::text);


--
-- Name: pipeline_feedback_actions; Type: TABLE; Schema: apic_runtime; Owner: -
--

CREATE TABLE apic_runtime.pipeline_feedback_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action text NOT NULL,
    environment text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    owner_tribe_id text,
    evidence_link text,
    reason text NOT NULL,
    actor_id text NOT NULL,
    actor_role text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    correlation_id text,
    CONSTRAINT pipeline_feedback_actions_action_check CHECK ((action = ANY (ARRAY['validation.rerun.requested'::text, 'evidence.reviewed'::text, 'decision.false_positive.marked'::text, 'onboarding.state.opened'::text, 'promotion.blocked'::text, 'schema.fix.requested'::text]))),
    CONSTRAINT pipeline_feedback_actions_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'prod'::text]))),
    CONSTRAINT pipeline_feedback_actions_false_positive_signal_check CHECK (((action <> 'decision.false_positive.marked'::text) OR (target_type = 'signal'::text))),
    CONSTRAINT pipeline_feedback_actions_reason_check CHECK ((length(TRIM(BOTH FROM reason)) > 0)),
    CONSTRAINT pipeline_feedback_actions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'blocking'::text, 'closed'::text]))),
    CONSTRAINT pipeline_feedback_actions_target_type_check CHECK ((target_type = ANY (ARRAY['topic'::text, 'tribe'::text, 'service'::text, 'event'::text, 'signal'::text, 'query'::text])))
);


--
-- Name: TABLE pipeline_feedback_actions; Type: COMMENT; Schema: apic_runtime; Owner: -
--

COMMENT ON TABLE apic_runtime.pipeline_feedback_actions IS 'retention=365d; partition=row_count_threshold_100000_per_month';


--
-- Name: s3_sink_topics; Type: TABLE; Schema: apic_runtime; Owner: -
--

CREATE TABLE apic_runtime.s3_sink_topics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    topic_id uuid NOT NULL,
    connector_name text NOT NULL,
    included boolean DEFAULT false NOT NULL,
    last_checked_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: test_quota_evaluations; Type: VIEW; Schema: apic_runtime; Owner: -
--

CREATE VIEW apic_runtime.test_quota_evaluations WITH (security_invoker='true') AS
 SELECT id,
    owner_tribe_id,
    policy_id,
    scope,
    target_service_id,
    route_family,
    window_start,
    window_end,
    request_count,
    max_requests,
    mode,
    outcome,
    correlation_id,
    created_at,
    environment
   FROM apic_runtime.quota_evaluations
  WHERE (environment = 'test'::text);


--
-- Name: test_usage_rollups; Type: VIEW; Schema: apic_runtime; Owner: -
--

CREATE VIEW apic_runtime.test_usage_rollups WITH (security_invoker='true') AS
 SELECT id,
    window_start,
    window_end,
    consumer_service_id,
    target_service_id,
    route_family,
    request_count,
    success_count,
    error_count,
    avg_latency_ms,
    p95_latency_ms,
    created_at,
    updated_at,
    environment
   FROM apic_runtime.usage_rollups
  WHERE (environment = 'test'::text);


--
-- Name: email_delivery_events; Type: TABLE; Schema: shared_email; Owner: -
--

CREATE TABLE shared_email.email_delivery_events (
    provider_event_id text NOT NULL,
    message_id text NOT NULL,
    status text NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_delivery_events_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'delivered'::text, 'delivery_delayed'::text, 'bounced'::text, 'complained'::text, 'failed'::text, 'suppressed'::text, 'opened'::text, 'clicked'::text])))
);


--
-- Name: TABLE email_delivery_events; Type: COMMENT; Schema: shared_email; Owner: -
--

COMMENT ON TABLE shared_email.email_delivery_events IS 'retention=400d; Resend delivery events keyed by unique provider event ID.';


--
-- Name: email_messages; Type: TABLE; Schema: shared_email; Owner: -
--

CREATE TABLE shared_email.email_messages (
    message_id text NOT NULL,
    tribe_id text NOT NULL,
    project_id text NOT NULL,
    service_id text NOT NULL,
    environment text NOT NULL,
    provider text NOT NULL,
    status text NOT NULL,
    recipients text[] NOT NULL,
    recipient_count integer NOT NULL,
    sent_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_messages_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
    CONSTRAINT email_messages_recipient_count_check CHECK ((recipient_count >= 0))
);


--
-- Name: project_senders; Type: TABLE; Schema: shared_email; Owner: -
--

CREATE TABLE shared_email.project_senders (
    project_id text NOT NULL,
    environment text NOT NULL,
    from_address text NOT NULL,
    daily_limit integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_senders_daily_limit_check CHECK (((daily_limit IS NULL) OR (daily_limit > 0))),
    CONSTRAINT project_senders_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
    CONSTRAINT project_senders_from_address_check CHECK (((length(btrim(from_address)) >= 1) AND (length(btrim(from_address)) <= 320)))
);


--
-- Name: TABLE project_senders; Type: COMMENT; Schema: shared_email; Owner: -
--

COMMENT ON TABLE shared_email.project_senders IS 'Project email sender configuration; one row per project and environment.';


--
-- Name: oauth_apps; Type: TABLE; Schema: shared_gauth; Owner: -
--

CREATE TABLE shared_gauth.oauth_apps (
    project_id text NOT NULL,
    environment text NOT NULL,
    redirect_uris text[] NOT NULL,
    client_id text,
    client_secret_ref text,
    display_name text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_secret_updated_at timestamp with time zone,
    CONSTRAINT oauth_apps_client_id_check CHECK (((client_id IS NULL) OR (btrim(client_id) <> ''::text))),
    CONSTRAINT oauth_apps_client_pair_check CHECK (((client_id IS NULL) = (client_secret_ref IS NULL))),
    CONSTRAINT oauth_apps_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
    CONSTRAINT oauth_apps_redirect_uris_check CHECK ((cardinality(redirect_uris) >= 1)),
    CONSTRAINT oauth_apps_secret_ref_check CHECK (((client_secret_ref IS NULL) OR (client_secret_ref ~ '^projects/[^/]+/secrets/[^/]+/versions/[^/]+$'::text))),
    CONSTRAINT oauth_apps_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);


--
-- Name: otp_challenges; Type: TABLE; Schema: shared_otp; Owner: -
--

CREATE TABLE shared_otp.otp_challenges (
    otp_id text NOT NULL,
    tribe_id text NOT NULL,
    project_id text NOT NULL,
    service_id text NOT NULL,
    environment text NOT NULL,
    channel text NOT NULL,
    target text NOT NULL,
    code_hash text NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT otp_challenges_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT otp_challenges_channel_check CHECK ((channel = ANY (ARRAY['sms'::text, 'email'::text]))),
    CONSTRAINT otp_challenges_code_hash_check CHECK ((code_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT otp_challenges_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
    CONSTRAINT otp_challenges_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'used'::text, 'expired'::text])))
);


--
-- Name: payment_event_outbox; Type: TABLE; Schema: shared_payment; Owner: -
--

CREATE TABLE shared_payment.payment_event_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    environment text NOT NULL,
    provider text DEFAULT 'paymongo'::text NOT NULL,
    provider_event_id text NOT NULL,
    event_type text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    aggregate_version integer DEFAULT 1 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_tribe_id text,
    consumer_service_id text,
    reference_id text,
    quarantine_reason text,
    quarantine_attempts integer DEFAULT 0 NOT NULL,
    quarantined_at timestamp with time zone,
    quarantine_expires_at timestamp with time zone,
    claim_token uuid,
    claimed_at timestamp with time zone,
    max_attempts integer DEFAULT 8 NOT NULL,
    project_id text NOT NULL
);


--
-- Name: payment_webhook_events; Type: TABLE; Schema: shared_payment; Owner: -
--

CREATE TABLE shared_payment.payment_webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text DEFAULT 'paymongo'::text NOT NULL,
    provider_mode text NOT NULL,
    provider_event_id text NOT NULL,
    event_type text NOT NULL,
    status text DEFAULT 'received'::text NOT NULL,
    payload_hash text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    received_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    processed_at timestamp(6) with time zone,
    error_message text
);


--
-- Name: resource_owners; Type: TABLE; Schema: shared_payment; Owner: -
--

CREATE TABLE shared_payment.resource_owners (
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    environment text NOT NULL,
    tribe_id text NOT NULL,
    consumer_service_id text NOT NULL,
    reference_id text,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    aggregate_version integer DEFAULT 1 NOT NULL,
    project_id text NOT NULL,
    amount_minor bigint,
    currency text,
    status text,
    provider_reference text,
    CONSTRAINT payment_resource_owners_status_lowercase_check CHECK (((status IS NULL) OR (status = lower(status)))),
    CONSTRAINT resource_owners_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text])))
);


--
-- Name: COLUMN resource_owners.provider_reference; Type: COMMENT; Schema: shared_payment; Owner: -
--

COMMENT ON COLUMN shared_payment.resource_owners.provider_reference IS 'Reference number PayMongo assigned to the resource. Paid payment-link events are matched only on this value.';


--
-- Name: sms_delivery_events; Type: TABLE; Schema: shared_sms; Owner: -
--

CREATE TABLE shared_sms.sms_delivery_events (
    provider_event_id text NOT NULL,
    message_id text NOT NULL,
    status text NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sms_delivery_events_status_check CHECK ((status = ANY (ARRAY['accepted'::text, 'scheduled'::text, 'queued'::text, 'sending'::text, 'sent'::text, 'delivered'::text, 'undelivered'::text, 'failed'::text, 'read'::text, 'canceled'::text])))
);


--
-- Name: TABLE sms_delivery_events; Type: COMMENT; Schema: shared_sms; Owner: -
--

COMMENT ON TABLE shared_sms.sms_delivery_events IS 'retention=400d; Twilio status callbacks keyed by unique provider event ID.';


--
-- Name: sms_messages; Type: TABLE; Schema: shared_sms; Owner: -
--

CREATE TABLE shared_sms.sms_messages (
    message_id text NOT NULL,
    tribe_id text NOT NULL,
    project_id text NOT NULL,
    service_id text NOT NULL,
    environment text NOT NULL,
    recipient text NOT NULL,
    message text NOT NULL,
    status text NOT NULL,
    sender_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sms_messages_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text])))
);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: apic_audit; Owner: -
--

ALTER TABLE ONLY apic_audit.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (organization_id, email);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (project_id);


--
-- Name: projects projects_project_tribe_unique; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.projects
    ADD CONSTRAINT projects_project_tribe_unique UNIQUE (project_id, tribe_id);


--
-- Name: service_dependencies service_dependencies_pkey; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_dependencies
    ADD CONSTRAINT service_dependencies_pkey PRIMARY KEY (id);


--
-- Name: service_environments service_environment_unique; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_environments
    ADD CONSTRAINT service_environment_unique UNIQUE (service_id, environment);


--
-- Name: service_environments service_environments_environment_check; Type: CHECK CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE apic_catalog.service_environments
    ADD CONSTRAINT service_environments_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))) NOT VALID;


--
-- Name: service_environments service_environments_pkey; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_environments
    ADD CONSTRAINT service_environments_pkey PRIMARY KEY (id);


--
-- Name: service_lifecycle_events service_lifecycle_events_pkey; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_lifecycle_events
    ADD CONSTRAINT service_lifecycle_events_pkey PRIMARY KEY (id);


--
-- Name: service_routes service_routes_pkey; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_routes
    ADD CONSTRAINT service_routes_pkey PRIMARY KEY (id);


--
-- Name: service_routes service_routes_service_id_method_path_key; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_routes
    ADD CONSTRAINT service_routes_service_id_method_path_key UNIQUE (service_id, method, path);


--
-- Name: service_scopes service_scopes_pkey; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_scopes
    ADD CONSTRAINT service_scopes_pkey PRIMARY KEY (id);


--
-- Name: service_scopes service_scopes_service_id_scope_key; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_scopes
    ADD CONSTRAINT service_scopes_service_id_scope_key UNIQUE (service_id, scope);


--
-- Name: service_spec_versions service_spec_versions_pkey; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_spec_versions
    ADD CONSTRAINT service_spec_versions_pkey PRIMARY KEY (id);


--
-- Name: service_spec_versions service_spec_versions_service_sha256_key; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_spec_versions
    ADD CONSTRAINT service_spec_versions_service_sha256_key UNIQUE (service_id, sha256);


--
-- Name: service_spec_versions service_spec_versions_service_version_key; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_spec_versions
    ADD CONSTRAINT service_spec_versions_service_version_key UNIQUE (service_id, version);


--
-- Name: services services_organization_id_service_id_key; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.services
    ADD CONSTRAINT services_organization_id_service_id_key UNIQUE (organization_id, service_id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: tribes tribes_pkey; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.tribes
    ADD CONSTRAINT tribes_pkey PRIMARY KEY (tribe_id);


--
-- Name: tribes tribes_tribe_organization_key; Type: CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.tribes
    ADD CONSTRAINT tribes_tribe_organization_key UNIQUE (tribe_id, organization_id);


--
-- Name: api_subscriptions api_subscriptions_pkey; Type: CONSTRAINT; Schema: apic_governance; Owner: -
--

ALTER TABLE ONLY apic_governance.api_subscriptions
    ADD CONSTRAINT api_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: approval_requests approval_requests_pkey; Type: CONSTRAINT; Schema: apic_governance; Owner: -
--

ALTER TABLE ONLY apic_governance.approval_requests
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);


--
-- Name: approval_requests approval_requests_target_environment_check; Type: CHECK CONSTRAINT; Schema: apic_governance; Owner: -
--

ALTER TABLE apic_governance.approval_requests
    ADD CONSTRAINT approval_requests_target_environment_check CHECK ((target_environment = ANY (ARRAY['test'::text, 'live'::text]))) NOT VALID;


--
-- Name: payment_api_keys payment_api_keys_key_hash_key; Type: CONSTRAINT; Schema: apic_governance; Owner: -
--

ALTER TABLE ONLY apic_governance.payment_api_keys
    ADD CONSTRAINT payment_api_keys_key_hash_key UNIQUE (key_hash);


--
-- Name: payment_api_keys payment_api_keys_pkey; Type: CONSTRAINT; Schema: apic_governance; Owner: -
--

ALTER TABLE ONLY apic_governance.payment_api_keys
    ADD CONSTRAINT payment_api_keys_pkey PRIMARY KEY (id);


--
-- Name: payment_consumer_services payment_consumer_services_owner_service_env_key; Type: CONSTRAINT; Schema: apic_governance; Owner: -
--

ALTER TABLE ONLY apic_governance.payment_consumer_services
    ADD CONSTRAINT payment_consumer_services_owner_service_env_key UNIQUE (owner_tribe_id, consumer_service_id, environment);


--
-- Name: payment_consumer_services payment_consumer_services_pkey; Type: CONSTRAINT; Schema: apic_governance; Owner: -
--

ALTER TABLE ONLY apic_governance.payment_consumer_services
    ADD CONSTRAINT payment_consumer_services_pkey PRIMARY KEY (id);


--
-- Name: payment_limit_overrides payment_limit_overrides_project_environment_key; Type: CONSTRAINT; Schema: apic_governance; Owner: -
--

ALTER TABLE ONLY apic_governance.payment_limit_overrides
    ADD CONSTRAINT payment_limit_overrides_project_environment_key UNIQUE (project_id, environment);


--
-- Name: payment_request_rate_windows payment_request_rate_windows_pkey; Type: CONSTRAINT; Schema: apic_governance; Owner: -
--

ALTER TABLE ONLY apic_governance.payment_request_rate_windows
    ADD CONSTRAINT payment_request_rate_windows_pkey PRIMARY KEY (project_id, environment);


--
-- Name: registry_change_requests service_registration_requests_pkey; Type: CONSTRAINT; Schema: apic_governance; Owner: -
--

ALTER TABLE ONLY apic_governance.registry_change_requests
    ADD CONSTRAINT service_registration_requests_pkey PRIMARY KEY (id);


--
-- Name: quota_policies tribe_api_quota_policies_pkey; Type: CONSTRAINT; Schema: apic_governance; Owner: -
--

ALTER TABLE ONLY apic_governance.quota_policies
    ADD CONSTRAINT tribe_api_quota_policies_pkey PRIMARY KEY (id);


--
-- Name: entitlement_assignments tribe_plan_assignments_pkey; Type: CONSTRAINT; Schema: apic_governance; Owner: -
--

ALTER TABLE ONLY apic_governance.entitlement_assignments
    ADD CONSTRAINT tribe_plan_assignments_pkey PRIMARY KEY (id);


--
-- Name: confluent_topics confluent_topics_pkey; Type: CONSTRAINT; Schema: apic_runtime; Owner: -
--

ALTER TABLE ONLY apic_runtime.confluent_topics
    ADD CONSTRAINT confluent_topics_pkey PRIMARY KEY (id);


--
-- Name: confluent_topics confluent_topics_topic_name_key; Type: CONSTRAINT; Schema: apic_runtime; Owner: -
--

ALTER TABLE ONLY apic_runtime.confluent_topics
    ADD CONSTRAINT confluent_topics_topic_name_key UNIQUE (topic_name);


--
-- Name: event_topic_onboarding_states event_topic_onboarding_states_environment_check; Type: CHECK CONSTRAINT; Schema: apic_runtime; Owner: -
--

ALTER TABLE apic_runtime.event_topic_onboarding_states
    ADD CONSTRAINT event_topic_onboarding_states_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))) NOT VALID;


--
-- Name: pipeline_feedback_actions pipeline_feedback_actions_pkey; Type: CONSTRAINT; Schema: apic_runtime; Owner: -
--

ALTER TABLE ONLY apic_runtime.pipeline_feedback_actions
    ADD CONSTRAINT pipeline_feedback_actions_pkey PRIMARY KEY (id);


--
-- Name: s3_sink_topics s3_sink_topics_pkey; Type: CONSTRAINT; Schema: apic_runtime; Owner: -
--

ALTER TABLE ONLY apic_runtime.s3_sink_topics
    ADD CONSTRAINT s3_sink_topics_pkey PRIMARY KEY (id);


--
-- Name: s3_sink_topics s3_sink_topics_topic_id_connector_name_key; Type: CONSTRAINT; Schema: apic_runtime; Owner: -
--

ALTER TABLE ONLY apic_runtime.s3_sink_topics
    ADD CONSTRAINT s3_sink_topics_topic_id_connector_name_key UNIQUE (topic_id, connector_name);


--
-- Name: event_topic_onboarding_states topic_onboarding_states_pkey; Type: CONSTRAINT; Schema: apic_runtime; Owner: -
--

ALTER TABLE ONLY apic_runtime.event_topic_onboarding_states
    ADD CONSTRAINT topic_onboarding_states_pkey PRIMARY KEY (physical_topic);


--
-- Name: quota_evaluations tribe_api_quota_decisions_pkey; Type: CONSTRAINT; Schema: apic_runtime; Owner: -
--

ALTER TABLE ONLY apic_runtime.quota_evaluations
    ADD CONSTRAINT tribe_api_quota_decisions_pkey PRIMARY KEY (id);


--
-- Name: usage_rollups usage_rollups_pkey; Type: CONSTRAINT; Schema: apic_runtime; Owner: -
--

ALTER TABLE ONLY apic_runtime.usage_rollups
    ADD CONSTRAINT usage_rollups_pkey PRIMARY KEY (id);


--
-- Name: email_delivery_events email_delivery_events_pkey; Type: CONSTRAINT; Schema: shared_email; Owner: -
--

ALTER TABLE ONLY shared_email.email_delivery_events
    ADD CONSTRAINT email_delivery_events_pkey PRIMARY KEY (provider_event_id);


--
-- Name: email_messages email_messages_pkey; Type: CONSTRAINT; Schema: shared_email; Owner: -
--

ALTER TABLE ONLY shared_email.email_messages
    ADD CONSTRAINT email_messages_pkey PRIMARY KEY (message_id);


--
-- Name: project_senders project_senders_pkey; Type: CONSTRAINT; Schema: shared_email; Owner: -
--

ALTER TABLE ONLY shared_email.project_senders
    ADD CONSTRAINT project_senders_pkey PRIMARY KEY (project_id, environment);


--
-- Name: oauth_apps oauth_apps_pkey; Type: CONSTRAINT; Schema: shared_gauth; Owner: -
--

ALTER TABLE ONLY shared_gauth.oauth_apps
    ADD CONSTRAINT oauth_apps_pkey PRIMARY KEY (project_id, environment);


--
-- Name: otp_challenges otp_challenges_pkey; Type: CONSTRAINT; Schema: shared_otp; Owner: -
--

ALTER TABLE ONLY shared_otp.otp_challenges
    ADD CONSTRAINT otp_challenges_pkey PRIMARY KEY (otp_id);


--
-- Name: payment_event_outbox payment_event_outbox_pkey; Type: CONSTRAINT; Schema: shared_payment; Owner: -
--

ALTER TABLE ONLY shared_payment.payment_event_outbox
    ADD CONSTRAINT payment_event_outbox_pkey PRIMARY KEY (id);


--
-- Name: payment_event_outbox payment_outbox_env_provider_event_uidx; Type: CONSTRAINT; Schema: shared_payment; Owner: -
--

ALTER TABLE ONLY shared_payment.payment_event_outbox
    ADD CONSTRAINT payment_outbox_env_provider_event_uidx UNIQUE (environment, provider, provider_event_id);


--
-- Name: payment_webhook_events payment_webhook_events_pkey; Type: CONSTRAINT; Schema: shared_payment; Owner: -
--

ALTER TABLE ONLY shared_payment.payment_webhook_events
    ADD CONSTRAINT payment_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: resource_owners resource_owners_pkey; Type: CONSTRAINT; Schema: shared_payment; Owner: -
--

ALTER TABLE ONLY shared_payment.resource_owners
    ADD CONSTRAINT resource_owners_pkey PRIMARY KEY (environment, resource_type, resource_id);


--
-- Name: sms_delivery_events sms_delivery_events_pkey; Type: CONSTRAINT; Schema: shared_sms; Owner: -
--

ALTER TABLE ONLY shared_sms.sms_delivery_events
    ADD CONSTRAINT sms_delivery_events_pkey PRIMARY KEY (provider_event_id);


--
-- Name: sms_messages sms_messages_pkey; Type: CONSTRAINT; Schema: shared_sms; Owner: -
--

ALTER TABLE ONLY shared_sms.sms_messages
    ADD CONSTRAINT sms_messages_pkey PRIMARY KEY (message_id);


--
-- Name: audit_events_actor_idx; Type: INDEX; Schema: apic_audit; Owner: -
--

CREATE INDEX audit_events_actor_idx ON apic_audit.audit_events USING btree (actor_type, actor_id, created_at DESC);


--
-- Name: audit_events_created_idx; Type: INDEX; Schema: apic_audit; Owner: -
--

CREATE INDEX audit_events_created_idx ON apic_audit.audit_events USING btree (created_at DESC);


--
-- Name: audit_events_env_resource_correlation_idx; Type: INDEX; Schema: apic_audit; Owner: -
--

CREATE INDEX audit_events_env_resource_correlation_idx ON apic_audit.audit_events USING btree (environment, resource_type, resource_id, correlation_id, created_at DESC);


--
-- Name: audit_events_resource_idx; Type: INDEX; Schema: apic_audit; Owner: -
--

CREATE INDEX audit_events_resource_idx ON apic_audit.audit_events USING btree (resource_type, resource_id, created_at DESC);


--
-- Name: audit_events_source_env_created_idx; Type: INDEX; Schema: apic_audit; Owner: -
--

CREATE INDEX audit_events_source_env_created_idx ON apic_audit.audit_events USING btree (source_service_id, environment, created_at DESC);


--
-- Name: audit_events_tribe_env_created_idx; Type: INDEX; Schema: apic_audit; Owner: -
--

CREATE INDEX audit_events_tribe_env_created_idx ON apic_audit.audit_events USING btree (tribe_id, environment, created_at DESC);


--
-- Name: organization_members_email_idx; Type: INDEX; Schema: apic_catalog; Owner: -
--

CREATE INDEX organization_members_email_idx ON apic_catalog.organization_members USING btree (email);


--
-- Name: projects_tribe_status_idx; Type: INDEX; Schema: apic_catalog; Owner: -
--

CREATE INDEX projects_tribe_status_idx ON apic_catalog.projects USING btree (tribe_id, status);


--
-- Name: service_dependencies_depends_on_idx; Type: INDEX; Schema: apic_catalog; Owner: -
--

CREATE INDEX service_dependencies_depends_on_idx ON apic_catalog.service_dependencies USING btree (depends_on_service_id);


--
-- Name: service_dependencies_service_idx; Type: INDEX; Schema: apic_catalog; Owner: -
--

CREATE INDEX service_dependencies_service_idx ON apic_catalog.service_dependencies USING btree (service_id);


--
-- Name: service_environments_env_status_idx; Type: INDEX; Schema: apic_catalog; Owner: -
--

CREATE INDEX service_environments_env_status_idx ON apic_catalog.service_environments USING btree (environment, status);


--
-- Name: service_environments_service_id_idx; Type: INDEX; Schema: apic_catalog; Owner: -
--

CREATE INDEX service_environments_service_id_idx ON apic_catalog.service_environments USING btree (service_id);


--
-- Name: service_lifecycle_events_service_idx; Type: INDEX; Schema: apic_catalog; Owner: -
--

CREATE INDEX service_lifecycle_events_service_idx ON apic_catalog.service_lifecycle_events USING btree (service_id);


--
-- Name: service_spec_versions_service_published_idx; Type: INDEX; Schema: apic_catalog; Owner: -
--

CREATE INDEX service_spec_versions_service_published_idx ON apic_catalog.service_spec_versions USING btree (service_id, published_at DESC);


--
-- Name: services_org_owner_type_status_idx; Type: INDEX; Schema: apic_catalog; Owner: -
--

CREATE INDEX services_org_owner_type_status_idx ON apic_catalog.services USING btree (organization_id, owner_tribe_id, service_type, status);


--
-- Name: services_owner_team_idx; Type: INDEX; Schema: apic_catalog; Owner: -
--

CREATE INDEX services_owner_team_idx ON apic_catalog.services USING btree (owner_team);


--
-- Name: services_owner_tribe_idx; Type: INDEX; Schema: apic_catalog; Owner: -
--

CREATE INDEX services_owner_tribe_idx ON apic_catalog.services USING btree (owner_tribe_id);


--
-- Name: services_project_idx; Type: INDEX; Schema: apic_catalog; Owner: -
--

CREATE INDEX services_project_idx ON apic_catalog.services USING btree (project_id);


--
-- Name: services_type_status_idx; Type: INDEX; Schema: apic_catalog; Owner: -
--

CREATE INDEX services_type_status_idx ON apic_catalog.services USING btree (service_type, status);


--
-- Name: api_subscriptions_api_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX api_subscriptions_api_idx ON apic_governance.api_subscriptions USING btree (api_project_id, api_service_id, environment, status, requested_at DESC);


--
-- Name: api_subscriptions_consumer_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX api_subscriptions_consumer_idx ON apic_governance.api_subscriptions USING btree (consumer_project_id, environment, status, requested_at DESC);


--
-- Name: api_subscriptions_one_approved_grant_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE UNIQUE INDEX api_subscriptions_one_approved_grant_idx ON apic_governance.api_subscriptions USING btree (consumer_project_id, api_project_id, api_service_id, environment) WHERE (status = 'approved'::text);


--
-- Name: api_subscriptions_one_pending_request_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE UNIQUE INDEX api_subscriptions_one_pending_request_idx ON apic_governance.api_subscriptions USING btree (consumer_project_id, api_project_id, api_service_id, environment) WHERE (status = 'pending'::text);


--
-- Name: approval_requests_action_env_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX approval_requests_action_env_idx ON apic_governance.approval_requests USING btree (action_type, target_environment);


--
-- Name: approval_requests_status_created_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX approval_requests_status_created_idx ON apic_governance.approval_requests USING btree (status, created_at DESC);


--
-- Name: approval_requests_target_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX approval_requests_target_idx ON apic_governance.approval_requests USING btree (target_id);


--
-- Name: entitlement_assignments_one_active_owner_project_env_uidx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE UNIQUE INDEX entitlement_assignments_one_active_owner_project_env_uidx ON apic_governance.entitlement_assignments USING btree (owner_tribe_id, project_id, environment) WHERE (status = 'active'::text);


--
-- Name: entitlement_assignments_owner_env_status_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX entitlement_assignments_owner_env_status_idx ON apic_governance.entitlement_assignments USING btree (owner_tribe_id, environment, status);


--
-- Name: entitlement_assignments_plan_env_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX entitlement_assignments_plan_env_idx ON apic_governance.entitlement_assignments USING btree (plan_key, environment);


--
-- Name: entitlement_assignments_project_env_status_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX entitlement_assignments_project_env_status_idx ON apic_governance.entitlement_assignments USING btree (project_id, environment, status);


--
-- Name: payment_api_keys_consumer_service_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX payment_api_keys_consumer_service_idx ON apic_governance.payment_api_keys USING btree (consumer_service_id);


--
-- Name: quota_policies_owner_status_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX quota_policies_owner_status_idx ON apic_governance.quota_policies USING btree (owner_tribe_id, status);


--
-- Name: quota_policies_project_status_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX quota_policies_project_status_idx ON apic_governance.quota_policies USING btree (project_id, status);


--
-- Name: quota_policies_scope_target_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX quota_policies_scope_target_idx ON apic_governance.quota_policies USING btree (scope, target_service_id);


--
-- Name: registry_change_requests_owner_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX registry_change_requests_owner_idx ON apic_governance.registry_change_requests USING btree (owner_tribe_id);


--
-- Name: registry_change_requests_project_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX registry_change_requests_project_idx ON apic_governance.registry_change_requests USING btree (project_id);


--
-- Name: registry_change_requests_service_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX registry_change_requests_service_idx ON apic_governance.registry_change_requests USING btree (service_id);


--
-- Name: registry_change_requests_status_created_idx; Type: INDEX; Schema: apic_governance; Owner: -
--

CREATE INDEX registry_change_requests_status_created_idx ON apic_governance.registry_change_requests USING btree (status, created_at DESC);


--
-- Name: confluent_topics_owner_service_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX confluent_topics_owner_service_idx ON apic_runtime.confluent_topics USING btree (owner_service_id);


--
-- Name: event_topic_onboarding_states_env_owner_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX event_topic_onboarding_states_env_owner_idx ON apic_runtime.event_topic_onboarding_states USING btree (environment, owner_tribe_id);


--
-- Name: event_topic_onboarding_states_updated_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX event_topic_onboarding_states_updated_idx ON apic_runtime.event_topic_onboarding_states USING btree (updated_at);


--
-- Name: pipeline_feedback_actions_correlation_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX pipeline_feedback_actions_correlation_idx ON apic_runtime.pipeline_feedback_actions USING btree (correlation_id);


--
-- Name: pipeline_feedback_actions_created_brin_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX pipeline_feedback_actions_created_brin_idx ON apic_runtime.pipeline_feedback_actions USING brin (created_at);


--
-- Name: pipeline_feedback_actions_env_target_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX pipeline_feedback_actions_env_target_idx ON apic_runtime.pipeline_feedback_actions USING btree (environment, target_id, created_at DESC);


--
-- Name: pipeline_feedback_actions_owner_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX pipeline_feedback_actions_owner_idx ON apic_runtime.pipeline_feedback_actions USING btree (owner_tribe_id, created_at DESC);


--
-- Name: pipeline_feedback_actions_status_created_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX pipeline_feedback_actions_status_created_idx ON apic_runtime.pipeline_feedback_actions USING btree (status, created_at DESC);


--
-- Name: quota_evaluations_correlation_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX quota_evaluations_correlation_idx ON apic_runtime.quota_evaluations USING btree (correlation_id);


--
-- Name: quota_evaluations_created_brin_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX quota_evaluations_created_brin_idx ON apic_runtime.quota_evaluations USING brin (created_at);


--
-- Name: quota_evaluations_env_route_window_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX quota_evaluations_env_route_window_idx ON apic_runtime.quota_evaluations USING btree (environment, owner_tribe_id, route_family, window_start DESC);


--
-- Name: quota_evaluations_environment_owner_created_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX quota_evaluations_environment_owner_created_idx ON apic_runtime.quota_evaluations USING btree (environment, owner_tribe_id, created_at DESC);


--
-- Name: quota_evaluations_environment_project_created_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX quota_evaluations_environment_project_created_idx ON apic_runtime.quota_evaluations USING btree (environment, project_id, created_at DESC);


--
-- Name: quota_evaluations_outcome_created_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX quota_evaluations_outcome_created_idx ON apic_runtime.quota_evaluations USING btree (outcome, created_at DESC);


--
-- Name: quota_evaluations_owner_created_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX quota_evaluations_owner_created_idx ON apic_runtime.quota_evaluations USING btree (owner_tribe_id, created_at DESC);


--
-- Name: usage_rollups_consumer_service_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX usage_rollups_consumer_service_idx ON apic_runtime.usage_rollups USING btree (consumer_service_id);


--
-- Name: usage_rollups_env_service_target_window_uidx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE UNIQUE INDEX usage_rollups_env_service_target_window_uidx ON apic_runtime.usage_rollups USING btree (environment, consumer_service_id, target_service_id, route_family, window_start, window_end);


--
-- Name: usage_rollups_environment_window_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX usage_rollups_environment_window_idx ON apic_runtime.usage_rollups USING btree (environment, window_start DESC);


--
-- Name: usage_rollups_target_service_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX usage_rollups_target_service_idx ON apic_runtime.usage_rollups USING btree (target_service_id);


--
-- Name: usage_rollups_window_end_brin_idx; Type: INDEX; Schema: apic_runtime; Owner: -
--

CREATE INDEX usage_rollups_window_end_brin_idx ON apic_runtime.usage_rollups USING brin (window_end);


--
-- Name: email_delivery_events_message_id_idx; Type: INDEX; Schema: shared_email; Owner: -
--

CREATE INDEX email_delivery_events_message_id_idx ON shared_email.email_delivery_events USING btree (message_id, received_at DESC);


--
-- Name: email_delivery_events_received_at_idx; Type: INDEX; Schema: shared_email; Owner: -
--

CREATE INDEX email_delivery_events_received_at_idx ON shared_email.email_delivery_events USING btree (received_at);


--
-- Name: email_messages_project_created_idx; Type: INDEX; Schema: shared_email; Owner: -
--

CREATE INDEX email_messages_project_created_idx ON shared_email.email_messages USING btree (project_id, environment, created_at);


--
-- Name: otp_challenges_project_created_idx; Type: INDEX; Schema: shared_otp; Owner: -
--

CREATE INDEX otp_challenges_project_created_idx ON shared_otp.otp_challenges USING btree (project_id, environment, created_at);


--
-- Name: otp_challenges_status_expires_idx; Type: INDEX; Schema: shared_otp; Owner: -
--

CREATE INDEX otp_challenges_status_expires_idx ON shared_otp.otp_challenges USING btree (status, expires_at);


--
-- Name: payment_outbox_claimable_idx; Type: INDEX; Schema: shared_payment; Owner: -
--

CREATE INDEX payment_outbox_claimable_idx ON shared_payment.payment_event_outbox USING btree (status, available_at, created_at);


--
-- Name: payment_outbox_consumer_pending_idx; Type: INDEX; Schema: shared_payment; Owner: -
--

CREATE INDEX payment_outbox_consumer_pending_idx ON shared_payment.payment_event_outbox USING btree (consumer_service_id, environment, status, available_at);


--
-- Name: payment_outbox_quarantine_retry_idx; Type: INDEX; Schema: shared_payment; Owner: -
--

CREATE INDEX payment_outbox_quarantine_retry_idx ON shared_payment.payment_event_outbox USING btree (status, available_at, quarantine_expires_at) WHERE (status = 'quarantined'::text);


--
-- Name: payment_outbox_status_available_idx; Type: INDEX; Schema: shared_payment; Owner: -
--

CREATE INDEX payment_outbox_status_available_idx ON shared_payment.payment_event_outbox USING btree (status, available_at);


--
-- Name: payment_resource_owners_project_environment_created_idx; Type: INDEX; Schema: shared_payment; Owner: -
--

CREATE INDEX payment_resource_owners_project_environment_created_idx ON shared_payment.resource_owners USING btree (project_id, environment, created_at DESC, resource_type DESC, resource_id DESC);


--
-- Name: payment_resource_owners_project_environment_status_created_idx; Type: INDEX; Schema: shared_payment; Owner: -
--

CREATE INDEX payment_resource_owners_project_environment_status_created_idx ON shared_payment.resource_owners USING btree (project_id, environment, status, created_at DESC, resource_type DESC, resource_id DESC);


--
-- Name: payment_resource_owners_project_environment_type_created_idx; Type: INDEX; Schema: shared_payment; Owner: -
--

CREATE INDEX payment_resource_owners_project_environment_type_created_idx ON shared_payment.resource_owners USING btree (project_id, environment, resource_type, created_at DESC, resource_id DESC);


--
-- Name: payment_resource_owners_project_reference_idx; Type: INDEX; Schema: shared_payment; Owner: -
--

CREATE INDEX payment_resource_owners_project_reference_idx ON shared_payment.resource_owners USING btree (environment, resource_type, project_id, reference_id) WHERE (reference_id IS NOT NULL);


--
-- Name: payment_resource_owners_provider_reference_key; Type: INDEX; Schema: shared_payment; Owner: -
--

CREATE UNIQUE INDEX payment_resource_owners_provider_reference_key ON shared_payment.resource_owners USING btree (environment, resource_type, provider_reference) WHERE (provider_reference IS NOT NULL);


--
-- Name: payment_webhook_events_provider_provider_mode_provider_even_key; Type: INDEX; Schema: shared_payment; Owner: -
--

CREATE UNIQUE INDEX payment_webhook_events_provider_provider_mode_provider_even_key ON shared_payment.payment_webhook_events USING btree (provider, provider_mode, provider_event_id);


--
-- Name: payment_webhook_type_received_idx; Type: INDEX; Schema: shared_payment; Owner: -
--

CREATE INDEX payment_webhook_type_received_idx ON shared_payment.payment_webhook_events USING btree (event_type, received_at);


--
-- Name: sms_delivery_events_message_id_idx; Type: INDEX; Schema: shared_sms; Owner: -
--

CREATE INDEX sms_delivery_events_message_id_idx ON shared_sms.sms_delivery_events USING btree (message_id, received_at DESC);


--
-- Name: sms_delivery_events_received_at_idx; Type: INDEX; Schema: shared_sms; Owner: -
--

CREATE INDEX sms_delivery_events_received_at_idx ON shared_sms.sms_delivery_events USING btree (received_at);


--
-- Name: sms_messages_project_created_idx; Type: INDEX; Schema: shared_sms; Owner: -
--

CREATE INDEX sms_messages_project_created_idx ON shared_sms.sms_messages USING btree (project_id, environment, created_at);


--
-- Name: organization_members organization_members_organization_id_fkey; Type: FK CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.organization_members
    ADD CONSTRAINT organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES apic_catalog.organizations(id) ON DELETE CASCADE;


--
-- Name: projects projects_tribe_id_fkey; Type: FK CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.projects
    ADD CONSTRAINT projects_tribe_id_fkey FOREIGN KEY (tribe_id) REFERENCES apic_catalog.tribes(tribe_id);


--
-- Name: service_dependencies service_dependencies_depends_on_service_id_fkey; Type: FK CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_dependencies
    ADD CONSTRAINT service_dependencies_depends_on_service_id_fkey FOREIGN KEY (depends_on_service_id) REFERENCES apic_catalog.services(id);


--
-- Name: service_dependencies service_dependencies_service_id_fkey; Type: FK CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_dependencies
    ADD CONSTRAINT service_dependencies_service_id_fkey FOREIGN KEY (service_id) REFERENCES apic_catalog.services(id) ON DELETE CASCADE;


--
-- Name: service_environments service_environments_service_id_fkey; Type: FK CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_environments
    ADD CONSTRAINT service_environments_service_id_fkey FOREIGN KEY (service_id) REFERENCES apic_catalog.services(id) ON DELETE CASCADE;


--
-- Name: service_lifecycle_events service_lifecycle_events_service_id_fkey; Type: FK CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_lifecycle_events
    ADD CONSTRAINT service_lifecycle_events_service_id_fkey FOREIGN KEY (service_id) REFERENCES apic_catalog.services(id) ON DELETE CASCADE;


--
-- Name: service_routes service_routes_service_id_fkey; Type: FK CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_routes
    ADD CONSTRAINT service_routes_service_id_fkey FOREIGN KEY (service_id) REFERENCES apic_catalog.services(id) ON DELETE CASCADE;


--
-- Name: service_scopes service_scopes_service_id_fkey; Type: FK CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_scopes
    ADD CONSTRAINT service_scopes_service_id_fkey FOREIGN KEY (service_id) REFERENCES apic_catalog.services(id) ON DELETE CASCADE;


--
-- Name: service_spec_versions service_spec_versions_service_id_fkey; Type: FK CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.service_spec_versions
    ADD CONSTRAINT service_spec_versions_service_id_fkey FOREIGN KEY (service_id) REFERENCES apic_catalog.services(id) ON DELETE RESTRICT;


--
-- Name: services services_organization_id_fkey; Type: FK CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.services
    ADD CONSTRAINT services_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES apic_catalog.organizations(id);


--
-- Name: services services_project_fk; Type: FK CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.services
    ADD CONSTRAINT services_project_fk FOREIGN KEY (project_id, owner_tribe_id) REFERENCES apic_catalog.projects(project_id, tribe_id);


--
-- Name: services services_tribe_organization_fk; Type: FK CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.services
    ADD CONSTRAINT services_tribe_organization_fk FOREIGN KEY (owner_tribe_id, organization_id) REFERENCES apic_catalog.tribes(tribe_id, organization_id);


--
-- Name: tribes tribes_organization_id_fkey; Type: FK CONSTRAINT; Schema: apic_catalog; Owner: -
--

ALTER TABLE ONLY apic_catalog.tribes
    ADD CONSTRAINT tribes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES apic_catalog.organizations(id);


--
-- Name: payment_api_keys payment_api_keys_consumer_service_id_fkey; Type: FK CONSTRAINT; Schema: apic_governance; Owner: -
--

ALTER TABLE ONLY apic_governance.payment_api_keys
    ADD CONSTRAINT payment_api_keys_consumer_service_id_fkey FOREIGN KEY (consumer_service_id) REFERENCES apic_governance.payment_consumer_services(id) ON DELETE CASCADE;


--
-- Name: s3_sink_topics s3_sink_topics_topic_id_fkey; Type: FK CONSTRAINT; Schema: apic_runtime; Owner: -
--

ALTER TABLE ONLY apic_runtime.s3_sink_topics
    ADD CONSTRAINT s3_sink_topics_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES apic_runtime.confluent_topics(id) ON DELETE CASCADE;


--
-- Name: SCHEMA apic_audit; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA apic_audit TO api_center_app;
GRANT USAGE ON SCHEMA apic_audit TO api_center_retention;


--
-- Name: SCHEMA apic_catalog; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA apic_catalog TO api_center_app;


--
-- Name: SCHEMA apic_governance; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA apic_governance TO api_center_app;
GRANT USAGE ON SCHEMA apic_governance TO api_center_retention;


--
-- Name: SCHEMA apic_runtime; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA apic_runtime TO api_center_app;
GRANT USAGE ON SCHEMA apic_runtime TO api_center_retention;


--
-- Name: SCHEMA shared_email; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA shared_email TO email_runtime;
GRANT USAGE ON SCHEMA shared_email TO api_center_retention;


--
-- Name: SCHEMA shared_gauth; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA shared_gauth TO gauth_runtime;


--
-- Name: SCHEMA shared_otp; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA shared_otp TO otp_runtime;


--
-- Name: SCHEMA shared_payment; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA shared_payment TO payments_runtime;


--
-- Name: SCHEMA shared_sms; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA shared_sms TO sms_runtime;
GRANT USAGE ON SCHEMA shared_sms TO api_center_retention;


--
-- Name: TABLE audit_events; Type: ACL; Schema: apic_audit; Owner: -
--

GRANT SELECT,INSERT ON TABLE apic_audit.audit_events TO api_center_app;
GRANT SELECT,DELETE ON TABLE apic_audit.audit_events TO api_center_retention;


--
-- Name: TABLE live_audit_events; Type: ACL; Schema: apic_audit; Owner: -
--

GRANT SELECT,INSERT ON TABLE apic_audit.live_audit_events TO api_center_app;


--
-- Name: TABLE test_audit_events; Type: ACL; Schema: apic_audit; Owner: -
--

GRANT SELECT,INSERT ON TABLE apic_audit.test_audit_events TO api_center_app;


--
-- Name: TABLE organization_members; Type: ACL; Schema: apic_catalog; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_catalog.organization_members TO api_center_app;


--
-- Name: TABLE organizations; Type: ACL; Schema: apic_catalog; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_catalog.organizations TO api_center_app;


--
-- Name: TABLE projects; Type: ACL; Schema: apic_catalog; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE apic_catalog.projects TO api_center_app;


--
-- Name: TABLE service_dependencies; Type: ACL; Schema: apic_catalog; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_catalog.service_dependencies TO api_center_app;


--
-- Name: TABLE service_environments; Type: ACL; Schema: apic_catalog; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_catalog.service_environments TO api_center_app;


--
-- Name: TABLE service_lifecycle_events; Type: ACL; Schema: apic_catalog; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_catalog.service_lifecycle_events TO api_center_app;


--
-- Name: TABLE service_routes; Type: ACL; Schema: apic_catalog; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_catalog.service_routes TO api_center_app;


--
-- Name: TABLE service_scopes; Type: ACL; Schema: apic_catalog; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_catalog.service_scopes TO api_center_app;


--
-- Name: TABLE service_spec_versions; Type: ACL; Schema: apic_catalog; Owner: -
--

GRANT SELECT,INSERT ON TABLE apic_catalog.service_spec_versions TO api_center_app;


--
-- Name: TABLE services; Type: ACL; Schema: apic_catalog; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_catalog.services TO api_center_app;


--
-- Name: TABLE tribes; Type: ACL; Schema: apic_catalog; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE apic_catalog.tribes TO api_center_app;


--
-- Name: TABLE api_subscriptions; Type: ACL; Schema: apic_governance; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE apic_governance.api_subscriptions TO api_center_app;


--
-- Name: TABLE approval_requests; Type: ACL; Schema: apic_governance; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_governance.approval_requests TO api_center_app;


--
-- Name: TABLE entitlement_assignments; Type: ACL; Schema: apic_governance; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_governance.entitlement_assignments TO api_center_app;


--
-- Name: TABLE payment_api_keys; Type: ACL; Schema: apic_governance; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE apic_governance.payment_api_keys TO api_center_app;


--
-- Name: TABLE payment_consumer_services; Type: ACL; Schema: apic_governance; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE apic_governance.payment_consumer_services TO api_center_app;


--
-- Name: TABLE payment_limit_overrides; Type: ACL; Schema: apic_governance; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_governance.payment_limit_overrides TO api_center_app;


--
-- Name: TABLE payment_request_rate_windows; Type: ACL; Schema: apic_governance; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_governance.payment_request_rate_windows TO api_center_app;


--
-- Name: TABLE quota_policies; Type: ACL; Schema: apic_governance; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_governance.quota_policies TO api_center_app;


--
-- Name: TABLE registry_change_requests; Type: ACL; Schema: apic_governance; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_governance.registry_change_requests TO api_center_app;


--
-- Name: TABLE confluent_topics; Type: ACL; Schema: apic_runtime; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_runtime.confluent_topics TO api_center_app;


--
-- Name: TABLE event_topic_onboarding_states; Type: ACL; Schema: apic_runtime; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_runtime.event_topic_onboarding_states TO api_center_app;


--
-- Name: TABLE quota_evaluations; Type: ACL; Schema: apic_runtime; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_runtime.quota_evaluations TO api_center_app;
GRANT SELECT,DELETE ON TABLE apic_runtime.quota_evaluations TO api_center_retention;


--
-- Name: TABLE live_quota_evaluations; Type: ACL; Schema: apic_runtime; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_runtime.live_quota_evaluations TO api_center_app;


--
-- Name: TABLE usage_rollups; Type: ACL; Schema: apic_runtime; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_runtime.usage_rollups TO api_center_app;
GRANT SELECT,DELETE ON TABLE apic_runtime.usage_rollups TO api_center_retention;


--
-- Name: TABLE live_usage_rollups; Type: ACL; Schema: apic_runtime; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_runtime.live_usage_rollups TO api_center_app;


--
-- Name: TABLE pipeline_feedback_actions; Type: ACL; Schema: apic_runtime; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_runtime.pipeline_feedback_actions TO api_center_app;
GRANT SELECT,DELETE ON TABLE apic_runtime.pipeline_feedback_actions TO api_center_retention;


--
-- Name: TABLE s3_sink_topics; Type: ACL; Schema: apic_runtime; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_runtime.s3_sink_topics TO api_center_app;


--
-- Name: TABLE test_quota_evaluations; Type: ACL; Schema: apic_runtime; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_runtime.test_quota_evaluations TO api_center_app;


--
-- Name: TABLE test_usage_rollups; Type: ACL; Schema: apic_runtime; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE apic_runtime.test_usage_rollups TO api_center_app;


--
-- Name: TABLE email_delivery_events; Type: ACL; Schema: shared_email; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE shared_email.email_delivery_events TO email_runtime;
GRANT SELECT,DELETE ON TABLE shared_email.email_delivery_events TO api_center_retention;


--
-- Name: TABLE email_messages; Type: ACL; Schema: shared_email; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE shared_email.email_messages TO email_runtime;


--
-- Name: TABLE project_senders; Type: ACL; Schema: shared_email; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE shared_email.project_senders TO email_runtime;


--
-- Name: TABLE oauth_apps; Type: ACL; Schema: shared_gauth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE shared_gauth.oauth_apps TO gauth_runtime;


--
-- Name: TABLE otp_challenges; Type: ACL; Schema: shared_otp; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE shared_otp.otp_challenges TO otp_runtime;


--
-- Name: TABLE payment_event_outbox; Type: ACL; Schema: shared_payment; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE shared_payment.payment_event_outbox TO payments_runtime;


--
-- Name: TABLE payment_webhook_events; Type: ACL; Schema: shared_payment; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE shared_payment.payment_webhook_events TO payments_runtime;


--
-- Name: TABLE resource_owners; Type: ACL; Schema: shared_payment; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE shared_payment.resource_owners TO payments_runtime;


--
-- Name: TABLE sms_delivery_events; Type: ACL; Schema: shared_sms; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE shared_sms.sms_delivery_events TO sms_runtime;
GRANT SELECT,DELETE ON TABLE shared_sms.sms_delivery_events TO api_center_retention;


--
-- Name: TABLE sms_messages; Type: ACL; Schema: shared_sms; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE shared_sms.sms_messages TO sms_runtime;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: apic_audit; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA apic_audit GRANT SELECT,INSERT ON TABLES TO api_center_app;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: apic_catalog; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA apic_catalog GRANT SELECT,INSERT,UPDATE ON TABLES TO api_center_app;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: apic_governance; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA apic_governance GRANT SELECT,INSERT,UPDATE ON TABLES TO api_center_app;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: apic_runtime; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA apic_runtime GRANT SELECT,INSERT,UPDATE ON TABLES TO api_center_app;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: shared_email; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA shared_email GRANT SELECT,USAGE ON SEQUENCES TO email_runtime;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: shared_email; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA shared_email GRANT SELECT,INSERT,UPDATE ON TABLES TO email_runtime;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: shared_gauth; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA shared_gauth GRANT SELECT,USAGE ON SEQUENCES TO gauth_runtime;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: shared_gauth; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA shared_gauth GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO gauth_runtime;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: shared_otp; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA shared_otp GRANT SELECT,USAGE ON SEQUENCES TO otp_runtime;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: shared_otp; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA shared_otp GRANT SELECT,INSERT,UPDATE ON TABLES TO otp_runtime;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: shared_payment; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA shared_payment GRANT SELECT,USAGE ON SEQUENCES TO payments_runtime;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: shared_payment; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA shared_payment GRANT SELECT,INSERT,UPDATE ON TABLES TO payments_runtime;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: shared_sms; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA shared_sms GRANT SELECT,USAGE ON SEQUENCES TO sms_runtime;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: shared_sms; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA shared_sms GRANT SELECT,INSERT,UPDATE ON TABLES TO sms_runtime;


--
-- PostgreSQL database dump complete
--
