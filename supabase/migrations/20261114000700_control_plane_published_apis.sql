-- Control plane rebuild, slice 8: published APIs.
-- Publishing is optional and separate from calling: an application calls APIs with its own
-- identity; a project may additionally publish an API (upstream, operations, actions) per
-- environment. Grants on an API are environment-kind bound and stay inside one organization.
-- A grant to another project's API needs that project's approval (cp_api_access_requests).
BEGIN;

CREATE TABLE apic_catalog.cp_published_apis (
  id text PRIMARY KEY CHECK (id ~ '^api_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  environment_kind text NOT NULL CHECK (environment_kind IN ('test','live')),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 128),
  upstream_url text NOT NULL CHECK (upstream_url ~ '^https?://' AND length(upstream_url) <= 2048),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (environment_id, project_id, organization_id)
    REFERENCES apic_catalog.cp_environments(id, project_id, organization_id),
  UNIQUE (environment_id, slug),
  UNIQUE (id, organization_id)
);

CREATE TABLE apic_catalog.cp_published_api_operations (
  organization_id uuid NOT NULL,
  api_id text NOT NULL,
  method text NOT NULL CHECK (method IN ('GET','POST','PUT','PATCH','DELETE')),
  path_pattern text NOT NULL CHECK (path_pattern ~ '^(/([A-Za-z0-9._~-]+|\{[A-Za-z][A-Za-z0-9_]*\}))+/?$|^/$'),
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)+$'),
  description text,
  PRIMARY KEY (api_id, method, path_pattern),
  FOREIGN KEY (api_id, organization_id) REFERENCES apic_catalog.cp_published_apis(id, organization_id) ON DELETE CASCADE
);

ALTER TABLE apic_catalog.cp_application_grants DROP CONSTRAINT cp_application_grants_target_kind_check;
ALTER TABLE apic_catalog.cp_application_grants
  ADD CONSTRAINT cp_application_grants_target_kind_check CHECK (target_kind IN ('capability','api'));

-- An API grant must target an API of the same organization and environment kind.
CREATE FUNCTION apic_catalog.cp_check_api_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  api_kind text;
  grantee_kind text;
BEGIN
  IF NEW.target_kind <> 'api' THEN
    RETURN NEW;
  END IF;
  SELECT environment_kind INTO api_kind FROM apic_catalog.cp_published_apis
   WHERE id = NEW.target_id AND organization_id = NEW.organization_id;
  SELECT kind INTO grantee_kind FROM apic_catalog.cp_environments WHERE id = NEW.environment_id;
  IF api_kind IS NULL OR api_kind <> grantee_kind THEN
    RAISE EXCEPTION 'API grants must target an API of the same organization and environment kind'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cp_application_grants_api_target BEFORE INSERT OR UPDATE ON apic_catalog.cp_application_grants
  FOR EACH ROW EXECUTE FUNCTION apic_catalog.cp_check_api_grant();

CREATE TABLE apic_catalog.cp_api_access_requests (
  id text PRIMARY KEY CHECK (id ~ '^acr_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL,
  api_id text NOT NULL,
  action text NOT NULL,
  consumer_project_id text NOT NULL,
  consumer_environment_id text NOT NULL,
  consumer_application_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by text NOT NULL,
  decided_by text,
  decided_at timestamptz,
  grant_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (api_id, organization_id) REFERENCES apic_catalog.cp_published_apis(id, organization_id),
  FOREIGN KEY (consumer_application_id, consumer_environment_id, consumer_project_id, organization_id)
    REFERENCES apic_catalog.cp_applications(id, environment_id, project_id, organization_id)
);
CREATE UNIQUE INDEX cp_api_access_requests_pending_idx
  ON apic_catalog.cp_api_access_requests (api_id, action, consumer_application_id) WHERE status = 'pending';

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['cp_published_apis','cp_published_api_operations','cp_api_access_requests'] LOOP
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
