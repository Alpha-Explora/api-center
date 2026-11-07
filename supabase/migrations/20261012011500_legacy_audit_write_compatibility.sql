-- Existing databases can retain columns from the retired audit-event shape.
-- Preserve historical values while allowing the canonical audit writer to omit them.
-- Fresh databases created from the baseline do not have these columns.
BEGIN;
SET LOCAL lock_timeout = '10s';
DO $$
DECLARE legacy_column text;
BEGIN
  FOREACH legacy_column IN ARRAY ARRAY['type', 'severity', 'message', 'occurred_at']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'apic_audit' AND table_name = 'audit_events'
        AND column_name = legacy_column
    ) THEN
      EXECUTE format('ALTER TABLE apic_audit.audit_events ALTER COLUMN %I DROP NOT NULL', legacy_column);
    END IF;
  END LOOP;
END $$;
COMMIT;
