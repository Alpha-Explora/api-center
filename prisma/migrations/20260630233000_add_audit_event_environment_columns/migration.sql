ALTER TABLE apic_audit.audit_events
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS source_service_id text,
  ADD COLUMN IF NOT EXISTS service_id text,
  ADD COLUMN IF NOT EXISTS tribe_id text;

UPDATE apic_audit.audit_events
SET environment = COALESCE(NULLIF(metadata->>'environment', ''), 'unknown')
WHERE environment IS NULL;

ALTER TABLE apic_audit.audit_events
  ALTER COLUMN environment SET DEFAULT 'unknown',
  ALTER COLUMN environment SET NOT NULL;

CREATE INDEX IF NOT EXISTS audit_events_env_resource_correlation_idx
  ON apic_audit.audit_events(environment, resource_type, resource_id, correlation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_source_env_created_idx
  ON apic_audit.audit_events(source_service_id, environment, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_tribe_env_created_idx
  ON apic_audit.audit_events(tribe_id, environment, created_at DESC);