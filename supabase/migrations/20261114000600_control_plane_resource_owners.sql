-- Control plane rebuild, slice 7: resource-owner mappings.
-- Runtimes scope records by an owner group and project. A control-plane project normally owns its
-- records as (organization ID, prj_ ID). A project migrated from the legacy model keeps the legacy
-- (tribe, project) owner for its environment until its historical records are reconciled, so its
-- applications keep seeing exactly the records the legacy project owned, and nothing more.
BEGIN;

CREATE TABLE apic_catalog.cp_resource_owner_mappings (
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  environment_kind text NOT NULL CHECK (environment_kind IN ('test','live')),
  owner_group_id text NOT NULL CHECK (length(owner_group_id) BETWEEN 1 AND 200),
  owner_project_id text NOT NULL CHECK (length(owner_project_id) BETWEEN 1 AND 200),
  migration_revision text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, environment_kind),
  FOREIGN KEY (project_id, organization_id) REFERENCES apic_catalog.cp_projects(id, organization_id)
);
-- One legacy owner maps to at most one control-plane project per environment.
CREATE UNIQUE INDEX cp_resource_owner_legacy_idx
  ON apic_catalog.cp_resource_owner_mappings (environment_kind, owner_group_id, owner_project_id);

ALTER TABLE apic_catalog.cp_resource_owner_mappings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON apic_catalog.cp_resource_owner_mappings TO api_center_app;
CREATE POLICY cp_resource_owner_mappings_tenant ON apic_catalog.cp_resource_owner_mappings TO api_center_app
  USING (apic_catalog.cp_tenant_visible(organization_id))
  WITH CHECK (apic_catalog.cp_tenant_visible(organization_id));

COMMIT;
