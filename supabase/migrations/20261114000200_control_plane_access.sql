-- Control plane rebuild, slice 3: console identity and roles.
-- Organization roles: owner, admin, developer, viewer. Stored legacy values keep their meaning:
-- operator = developer, observer = viewer. Teams are optional groups of members that receive
-- project roles; they never contain projects and never grant application API access.
BEGIN;

ALTER TABLE apic_catalog.organization_members DROP CONSTRAINT IF EXISTS organization_members_role_check;
ALTER TABLE apic_catalog.organization_members
  ADD CONSTRAINT organization_members_role_check
  CHECK (role IN ('owner','admin','developer','viewer','operator','observer'));

-- The verified identity subject is linked on first verified sign-in. Afterwards a token for the
-- same email with a different subject is rejected, so a recycled email address cannot inherit access.
ALTER TABLE apic_catalog.organization_members ADD COLUMN subject text;
ALTER TABLE apic_catalog.organization_members
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'));
CREATE UNIQUE INDEX organization_members_subject_idx
  ON apic_catalog.organization_members (organization_id, subject) WHERE subject IS NOT NULL;

CREATE TABLE apic_catalog.cp_teams (
  id text PRIMARY KEY CHECK (id ~ '^tm_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL REFERENCES apic_catalog.organizations(id),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 128),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug),
  UNIQUE (id, organization_id)
);

CREATE TABLE apic_catalog.cp_team_members (
  organization_id uuid NOT NULL,
  team_id text NOT NULL,
  email text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 320),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, email),
  FOREIGN KEY (team_id, organization_id) REFERENCES apic_catalog.cp_teams(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, email) REFERENCES apic_catalog.organization_members(organization_id, email) ON DELETE CASCADE
);

CREATE TABLE apic_catalog.cp_project_role_assignments (
  id text PRIMARY KEY CHECK (id ~ '^pra_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  member_email text,
  team_id text,
  role text NOT NULL CHECK (role IN ('admin','developer','viewer')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES apic_catalog.cp_projects(id, organization_id),
  FOREIGN KEY (organization_id, member_email) REFERENCES apic_catalog.organization_members(organization_id, email) ON DELETE CASCADE,
  FOREIGN KEY (team_id, organization_id) REFERENCES apic_catalog.cp_teams(id, organization_id) ON DELETE CASCADE,
  CHECK ((member_email IS NULL) <> (team_id IS NULL))
);
CREATE UNIQUE INDEX cp_project_role_member_idx
  ON apic_catalog.cp_project_role_assignments (project_id, member_email) WHERE member_email IS NOT NULL;
CREATE UNIQUE INDEX cp_project_role_team_idx
  ON apic_catalog.cp_project_role_assignments (project_id, team_id) WHERE team_id IS NOT NULL;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['cp_teams','cp_team_members','cp_project_role_assignments'] LOOP
    EXECUTE format('ALTER TABLE apic_catalog.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON apic_catalog.%I TO api_center_app', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON apic_catalog.%I TO api_center_app USING (true) WITH CHECK (true)',
      table_name || '_app', table_name
    );
  END LOOP;
END;
$$;

COMMIT;
