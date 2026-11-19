-- Console observability: organization and project attribution for audit events, and indexes for
-- the per-environment request log and the audit log.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- Who an audit event belongs to. Control-plane writers set both; organization-level events
-- (members, teams) have no project. Older events stay unattributed unless the backfill below finds
-- their project.
ALTER TABLE apic_audit.audit_events
  ADD COLUMN IF NOT EXISTS organization_id uuid,
  ADD COLUMN IF NOT EXISTS project_id text;

COMMENT ON COLUMN apic_audit.audit_events.organization_id IS 'Owning control-plane organization; NULL for platform and legacy events.';
COMMENT ON COLUMN apic_audit.audit_events.project_id IS 'Owning control-plane project; NULL for organization-level events.';

-- Organization-level events (members, teams, API access decisions) have no environment. They used
-- to be written as 'unknown', which this check rejected, so they never reached the table.
ALTER TABLE apic_audit.audit_events DROP CONSTRAINT IF EXISTS audit_events_environment_check;
ALTER TABLE apic_audit.audit_events
  ADD CONSTRAINT audit_events_environment_check CHECK (environment IN ('test', 'live', 'none')) NOT VALID;
ALTER TABLE apic_audit.audit_events VALIDATE CONSTRAINT audit_events_environment_check;

-- Best-effort backfill: events whose payload or resource names a control-plane project.
UPDATE apic_audit.audit_events
SET project_id = metadata -> 'payload' ->> 'projectId'
WHERE project_id IS NULL
  AND action LIKE 'control\_plane.%'
  AND metadata -> 'payload' ->> 'projectId' ~ '^prj_[a-z0-9]{24}$';

UPDATE apic_audit.audit_events
SET project_id = resource_id
WHERE project_id IS NULL
  AND action = 'control_plane.project.created'
  AND resource_id ~ '^prj_[a-z0-9]{24}$';

UPDATE apic_audit.audit_events AS event
SET organization_id = project.organization_id
FROM apic_catalog.cp_projects AS project
WHERE event.organization_id IS NULL
  AND event.project_id = project.id;

CREATE INDEX IF NOT EXISTS audit_events_organization_idx
  ON apic_audit.audit_events (organization_id, created_at DESC, id DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_events_project_idx
  ON apic_audit.audit_events (organization_id, project_id, created_at DESC, id DESC)
  WHERE project_id IS NOT NULL;

-- The console's request log reads one project environment, newest first.
CREATE INDEX IF NOT EXISTS request_diagnostics_project_idx
  ON apic_runtime.request_diagnostics (project_id, environment, created_at DESC, request_id DESC)
  WHERE project_id IS NOT NULL;

COMMIT;
