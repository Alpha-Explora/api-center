-- Control plane rebuild, slice 13: workload identity.
-- A binding maps one exact (issuer, subject, audience) of a verified OIDC ID token, such as a Cloud
-- Run service account's Google-signed token, to one application. There is no wildcard or
-- domain-wide matching: every workload is bound individually.
BEGIN;

CREATE TABLE apic_catalog.cp_workload_bindings (
  id text PRIMARY KEY CHECK (id ~ '^wlb_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  application_id text NOT NULL,
  issuer text NOT NULL CHECK (issuer ~ '^https://[^*\s]+$'),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255 AND subject !~ '[*\s]'),
  audience text NOT NULL CHECK (length(audience) BETWEEN 1 AND 2048 AND audience !~ '[*\s]'),
  description text CHECK (description IS NULL OR length(description) <= 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by text,
  revoked_at timestamptz,
  FOREIGN KEY (application_id, environment_id, project_id, organization_id)
    REFERENCES apic_catalog.cp_applications(id, environment_id, project_id, organization_id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
-- One workload identity resolves to exactly one application.
CREATE UNIQUE INDEX cp_workload_bindings_identity_idx
  ON apic_catalog.cp_workload_bindings (issuer, subject, audience) WHERE status = 'active';

ALTER TABLE apic_catalog.cp_workload_bindings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON apic_catalog.cp_workload_bindings TO api_center_app;
CREATE POLICY cp_workload_bindings_tenant ON apic_catalog.cp_workload_bindings TO api_center_app
  USING (apic_catalog.cp_tenant_visible(organization_id))
  WITH CHECK (apic_catalog.cp_tenant_visible(organization_id));

-- The request path must find a workload's organization before it can set the tenant. This
-- definer function returns only the organization and application of one exact active binding.
CREATE FUNCTION apic_catalog.cp_workload_binding(p_issuer text, p_subject text, p_audience text)
RETURNS TABLE (organization_id uuid, application_id text, binding_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT organization_id, application_id, id FROM apic_catalog.cp_workload_bindings
   WHERE issuer = p_issuer AND subject = p_subject AND audience = p_audience AND status = 'active'
$$;
REVOKE ALL ON FUNCTION apic_catalog.cp_workload_binding(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apic_catalog.cp_workload_binding(text, text, text) TO api_center_app;

COMMIT;
