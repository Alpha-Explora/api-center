-- Control plane rebuild, slice 1: organization-owned projects, environments, applications,
-- capability installations, explicit grants and application credentials.
-- Every child row carries its full ownership tuple. Composite foreign keys make a row
-- referencing another organization's, project's or environment's resources unrepresentable.
-- Legacy tribe/project/service tables are untouched.
BEGIN;

CREATE TABLE apic_catalog.cp_projects (
  id text PRIMARY KEY CHECK (id ~ '^prj_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL REFERENCES apic_catalog.organizations(id),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 128),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_by text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug),
  UNIQUE (id, organization_id)
);

CREATE TABLE apic_catalog.cp_environments (
  id text PRIMARY KEY CHECK (id ~ '^env_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('test','live')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES apic_catalog.cp_projects(id, organization_id),
  UNIQUE (project_id, kind),
  UNIQUE (id, project_id, organization_id)
);

-- Environment kind is immutable once created.
CREATE FUNCTION apic_catalog.cp_environment_kind_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'environment kind and ownership are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cp_environments_kind_immutable BEFORE UPDATE ON apic_catalog.cp_environments
  FOR EACH ROW EXECUTE FUNCTION apic_catalog.cp_environment_kind_immutable();

CREATE TABLE apic_catalog.cp_applications (
  id text PRIMARY KEY CHECK (id ~ '^app_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 128),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  authorization_version integer NOT NULL DEFAULT 1 CHECK (authorization_version > 0),
  created_by text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (environment_id, project_id, organization_id)
    REFERENCES apic_catalog.cp_environments(id, project_id, organization_id),
  UNIQUE (environment_id, slug),
  UNIQUE (id, environment_id, project_id, organization_id)
);

CREATE TABLE apic_catalog.cp_capability_installations (
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  capability text NOT NULL CHECK (capability ~ '^[a-z][a-z0-9-]{0,31}$'),
  status text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled')),
  created_by text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, capability),
  FOREIGN KEY (environment_id, project_id, organization_id)
    REFERENCES apic_catalog.cp_environments(id, project_id, organization_id)
);

CREATE TABLE apic_catalog.cp_application_grants (
  id text PRIMARY KEY CHECK (id ~ '^grt_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  application_id text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('capability')),
  target_id text NOT NULL,
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)+$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  provenance text NOT NULL DEFAULT 'explicit' CHECK (provenance IN ('explicit','legacy-snapshot')),
  created_by text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by text,
  revoked_at timestamptz,
  FOREIGN KEY (application_id, environment_id, project_id, organization_id)
    REFERENCES apic_catalog.cp_applications(id, environment_id, project_id, organization_id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX cp_application_grants_active_idx
  ON apic_catalog.cp_application_grants(application_id, target_kind, target_id, action)
  WHERE status = 'active';

CREATE TABLE apic_catalog.cp_credentials (
  id text PRIMARY KEY CHECK (id ~ '^crd_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  application_id text NOT NULL,
  environment_kind text NOT NULL CHECK (environment_kind IN ('test','live')),
  lookup_prefix text NOT NULL UNIQUE CHECK (lookup_prefix ~ '^ak_(test|live)_[a-z0-9]{16}$'),
  verifier_sha256 char(64) NOT NULL CHECK (verifier_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  expires_at timestamptz NOT NULL,
  created_by text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_by text,
  revoked_at timestamptz,
  revoked_reason text CHECK (revoked_reason IS NULL OR length(revoked_reason) BETWEEN 1 AND 500),
  FOREIGN KEY (application_id, environment_id, project_id, organization_id)
    REFERENCES apic_catalog.cp_applications(id, environment_id, project_id, organization_id),
  CHECK (substring(lookup_prefix FROM 4 FOR 4) = environment_kind),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CHECK (expires_at > created_at)
);
CREATE INDEX cp_credentials_application_idx ON apic_catalog.cp_credentials(application_id, status);

-- Issuance receipts. A retried operationId never mints a second credential and never re-reveals one.
CREATE TABLE apic_catalog.cp_credential_operations (
  operation_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  application_id text NOT NULL,
  fingerprint char(64) NOT NULL,
  credential_id text NOT NULL REFERENCES apic_catalog.cp_credentials(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'cp_projects','cp_environments','cp_applications','cp_capability_installations',
    'cp_application_grants','cp_credentials','cp_credential_operations'
  ] LOOP
    EXECUTE format('ALTER TABLE apic_catalog.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON apic_catalog.%I TO api_center_app', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON apic_catalog.%I TO api_center_app USING (true) WITH CHECK (true)',
      table_name || '_app', table_name
    );
  END LOOP;
END;
$$;

COMMENT ON TABLE apic_catalog.cp_projects IS 'Control plane v2: organization-owned project; no tribe';
COMMENT ON TABLE apic_catalog.cp_credentials IS 'Control plane v2: application credential verifiers; never plaintext';
COMMENT ON TABLE apic_catalog.cp_credential_operations IS 'Control plane v2: credential issuance receipts; no secret material';

COMMIT;
