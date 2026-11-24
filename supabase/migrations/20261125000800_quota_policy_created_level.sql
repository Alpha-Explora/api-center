BEGIN;
ALTER TABLE apic_catalog.cp_quota_policies ADD COLUMN created_level text NOT NULL DEFAULT 'project'
  CHECK (created_level IN ('organization', 'project'));
UPDATE apic_catalog.cp_quota_policies SET created_level = 'organization' WHERE scope <> 'project';
COMMIT;
