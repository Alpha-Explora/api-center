-- Control plane rebuild, slice 10: legacy migration machinery.
-- cp_legacy_mappings: which control-plane record each legacy record became (idempotent backfill).
-- cp_control_plane_assignments: which model is authoritative per project environment, with a
--   fence version that every transition must name, so two systems never mutate one principal.
-- cp_shadow_mismatches: legacy calls whose new-model decision differs; cutover waits for none.
-- cp_migration_runs: audited inventory, backfill, cutover and rollback receipts.
BEGIN;

CREATE TABLE apic_catalog.cp_legacy_mappings (
  organization_id uuid NOT NULL REFERENCES apic_catalog.organizations(id),
  source_kind text NOT NULL CHECK (source_kind IN ('tribe','project','service','published_service','tribe_ceiling','quota_policy')),
  source_id text NOT NULL,
  environment_kind text NOT NULL DEFAULT '' CHECK (environment_kind IN ('','test','live')),
  target_kind text NOT NULL CHECK (target_kind IN ('team','project','application','published_api','quota_policy')),
  target_id text NOT NULL,
  migration_revision text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_kind, source_id, environment_kind)
);
CREATE INDEX cp_legacy_mappings_target_idx ON apic_catalog.cp_legacy_mappings (target_kind, target_id);

CREATE TABLE apic_catalog.cp_control_plane_assignments (
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  environment_kind text NOT NULL CHECK (environment_kind IN ('test','live')),
  authority text NOT NULL CHECK (authority IN ('legacy','new')),
  fence_version integer NOT NULL DEFAULT 0 CHECK (fence_version >= 0),
  legacy_project_id text NOT NULL,
  legacy_tribe_id text NOT NULL,
  migration_revision text NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  cut_over_at timestamptz,
  PRIMARY KEY (project_id, environment_kind),
  FOREIGN KEY (project_id, organization_id) REFERENCES apic_catalog.cp_projects(id, organization_id)
);
CREATE UNIQUE INDEX cp_assignments_legacy_project_idx
  ON apic_catalog.cp_control_plane_assignments (legacy_project_id, environment_kind);

CREATE TABLE apic_catalog.cp_shadow_mismatches (
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  environment_kind text NOT NULL CHECK (environment_kind IN ('test','live')),
  source_service_id text NOT NULL,
  target text NOT NULL,
  action text NOT NULL,
  legacy_allowed boolean NOT NULL,
  new_allowed boolean NOT NULL,
  occurrences integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution text,
  PRIMARY KEY (project_id, environment_kind, source_service_id, target, action, legacy_allowed),
  FOREIGN KEY (project_id, organization_id) REFERENCES apic_catalog.cp_projects(id, organization_id),
  CHECK (legacy_allowed <> new_allowed)
);

CREATE TABLE apic_catalog.cp_migration_runs (
  id text PRIMARY KEY CHECK (id ~ '^mig_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL REFERENCES apic_catalog.organizations(id),
  kind text NOT NULL CHECK (kind IN ('backfill','cutover','rollback')),
  project_id text,
  environment_kind text,
  migration_revision text NOT NULL,
  report jsonb NOT NULL DEFAULT '{}',
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['cp_legacy_mappings','cp_control_plane_assignments','cp_shadow_mismatches','cp_migration_runs'] LOOP
    EXECUTE format('ALTER TABLE apic_catalog.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON apic_catalog.%I TO api_center_app', table_name);
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
