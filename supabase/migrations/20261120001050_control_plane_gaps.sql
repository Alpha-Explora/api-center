-- Control-plane gaps closed by the console:
-- - quota policies can be edited and deleted. Delete is soft (status 'deleted'), so audit events and
--   counters keep pointing at a real row; enforcement already reads only 'active' policies.
-- - an API access request can carry the reason it was rejected, shown to the requesting project,
--   which can now list its own outgoing requests.
-- - a webhook destination can limit delivery to chosen event types (empty: every type).
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE apic_catalog.cp_quota_policies DROP CONSTRAINT IF EXISTS cp_quota_policies_status_check;
ALTER TABLE apic_catalog.cp_quota_policies
  ADD CONSTRAINT cp_quota_policies_status_check CHECK (status IN ('active', 'disabled', 'deleted')),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text;
ALTER TABLE apic_catalog.cp_quota_policies DROP CONSTRAINT IF EXISTS cp_quota_policies_deleted_check;
ALTER TABLE apic_catalog.cp_quota_policies
  ADD CONSTRAINT cp_quota_policies_deleted_check CHECK ((status = 'deleted') = (deleted_at IS NOT NULL));

ALTER TABLE apic_catalog.cp_api_access_requests
  ADD COLUMN IF NOT EXISTS rejection_reason text CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 500);

-- A project's outgoing requests, newest first.
CREATE INDEX IF NOT EXISTS cp_api_access_requests_consumer_idx
  ON apic_catalog.cp_api_access_requests (organization_id, consumer_project_id, created_at DESC);

ALTER TABLE apic_catalog.cp_event_destinations
  ADD COLUMN IF NOT EXISTS event_types text[] NOT NULL DEFAULT '{}' CHECK (cardinality(event_types) <= 50);

COMMENT ON COLUMN apic_catalog.cp_event_destinations.event_types IS
  'Event types delivered to this destination; empty delivers every type. Webhooks apply it in the delivery service.';

COMMIT;
