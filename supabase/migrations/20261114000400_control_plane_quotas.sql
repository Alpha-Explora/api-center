-- Control plane rebuild, slice 5: plans, quotas and usage for application requests.
-- Composition is conjunctive: a request must fit every applicable budget (plan default, project
-- policies, shared ceilings). Budgets are reserved atomically in one transaction; a request key
-- is counted once, so retries of one idempotent operation are not double counted.
BEGIN;

CREATE TABLE apic_catalog.cp_entitlements (
  id text PRIMARY KEY CHECK (id ~ '^ent_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  plan_key text NOT NULL CHECK (plan_key ~ '^[a-z][a-z0-9-]{0,31}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  assigned_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (environment_id, project_id, organization_id)
    REFERENCES apic_catalog.cp_environments(id, project_id, organization_id)
);
CREATE UNIQUE INDEX cp_entitlements_active_idx ON apic_catalog.cp_entitlements(environment_id) WHERE status = 'active';

-- scope 'project': one project's environment kind. scope 'shared': an organization ceiling over an
-- explicit covered project set (cp_quota_policy_projects); it never silently covers other projects.
CREATE TABLE apic_catalog.cp_quota_policies (
  id text PRIMARY KEY CHECK (id ~ '^qp_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL REFERENCES apic_catalog.organizations(id),
  scope text NOT NULL CHECK (scope IN ('project','shared')),
  project_id text,
  environment_kind text NOT NULL CHECK (environment_kind IN ('test','live')),
  capability text CHECK (capability IS NULL OR capability ~ '^[a-z][a-z0-9-]{0,31}$'),
  window_seconds integer NOT NULL CHECK (window_seconds BETWEEN 1 AND 2678400),
  max_requests integer NOT NULL CHECK (max_requests > 0),
  mode text NOT NULL DEFAULT 'enforce' CHECK (mode IN ('observe','enforce')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  provenance text NOT NULL DEFAULT 'explicit' CHECK (provenance IN ('explicit','legacy-tribe-ceiling')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES apic_catalog.cp_projects(id, organization_id),
  CHECK ((scope = 'project') = (project_id IS NOT NULL)),
  UNIQUE (id, organization_id)
);

CREATE TABLE apic_catalog.cp_quota_policy_projects (
  organization_id uuid NOT NULL,
  policy_id text NOT NULL,
  project_id text NOT NULL,
  PRIMARY KEY (policy_id, project_id),
  FOREIGN KEY (policy_id, organization_id) REFERENCES apic_catalog.cp_quota_policies(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, organization_id) REFERENCES apic_catalog.cp_projects(id, organization_id)
);

CREATE TABLE apic_catalog.cp_quota_counters (
  organization_id uuid NOT NULL REFERENCES apic_catalog.organizations(id),
  budget_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0),
  PRIMARY KEY (budget_key, window_start)
);

CREATE TABLE apic_catalog.cp_usage_records (
  organization_id uuid NOT NULL REFERENCES apic_catalog.organizations(id),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 400),
  project_id text NOT NULL,
  environment_id text NOT NULL,
  application_id text NOT NULL,
  capability text NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL DEFAULT 'admitted' CHECK (outcome IN ('admitted','completed','failed')),
  status_code integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (organization_id, request_key),
  FOREIGN KEY (application_id, environment_id, project_id, organization_id)
    REFERENCES apic_catalog.cp_applications(id, environment_id, project_id, organization_id)
);
CREATE INDEX cp_usage_records_environment_idx ON apic_catalog.cp_usage_records(environment_id, created_at DESC);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'cp_entitlements','cp_quota_policies','cp_quota_policy_projects','cp_quota_counters','cp_usage_records'
  ] LOOP
    EXECUTE format('ALTER TABLE apic_catalog.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON apic_catalog.%I TO api_center_app', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON apic_catalog.%I TO api_center_app '
      'USING (apic_catalog.cp_tenant_visible(organization_id)) '
      'WITH CHECK (apic_catalog.cp_tenant_visible(organization_id))',
      table_name || '_tenant', table_name
    );
  END LOOP;
END;
$$;

COMMIT;
