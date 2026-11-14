-- Control plane rebuild, slice 4: tenant isolation for control-plane rows.
-- The gateway runs every control-plane query in a transaction that sets
--   apicenter.organization_id  (the tenant), or
--   apicenter.scope = 'platform' (platform-wide administration).
-- For api_center_app, rows of other organizations are invisible and cannot be written.
-- Settings are transaction-local (set_config(..., true)), so pooled connections keep no tenant.
BEGIN;

CREATE FUNCTION apic_catalog.cp_tenant_visible(row_organization uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT current_setting('apicenter.scope', true) = 'platform'
      OR row_organization = nullif(current_setting('apicenter.organization_id', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION apic_catalog.cp_tenant_visible(uuid) TO api_center_app;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'cp_projects','cp_environments','cp_applications','cp_capability_installations',
    'cp_application_grants','cp_credentials','cp_credential_operations',
    'cp_teams','cp_team_members','cp_project_role_assignments'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON apic_catalog.%I', table_name || '_app', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON apic_catalog.%I TO api_center_app '
      'USING (apic_catalog.cp_tenant_visible(organization_id)) '
      'WITH CHECK (apic_catalog.cp_tenant_visible(organization_id))',
      table_name || '_tenant', table_name
    );
  END LOOP;
END;
$$;

-- The request path must find a credential's organization before it can set the tenant. This
-- definer function discloses only that organization ID, and only for an exact lookup prefix.
CREATE FUNCTION apic_catalog.cp_credential_organization(prefix text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT organization_id FROM apic_catalog.cp_credentials WHERE lookup_prefix = prefix
$$;
REVOKE ALL ON FUNCTION apic_catalog.cp_credential_organization(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apic_catalog.cp_credential_organization(text) TO api_center_app;

COMMIT;
