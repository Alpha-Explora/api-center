-- Retention for the control plane's fastest-growing tables. Every gateway request writes a usage
-- record and touches quota counters, and every key issue writes an operation receipt; none of them
-- was ever deleted. scripts/purge-expired-history.cjs reads each window from the table comment and
-- runs as api_center_retention, which needs a policy to see past row-level security.
--   cp_usage_records: 90 days. The console reads 30 days of usage; a retried request is matched
--     within one UTC day.
--   cp_quota_counters: 62 days after the window starts. The longest quota window is 31 days.
--   cp_credential_operations: 30 days. A key-issue retry carries the same operation ID within
--     minutes; after that the receipt is only history.
BEGIN;
SET LOCAL lock_timeout = '10s';

GRANT USAGE ON SCHEMA apic_catalog TO api_center_retention;
GRANT SELECT, DELETE ON apic_catalog.cp_usage_records, apic_catalog.cp_quota_counters, apic_catalog.cp_credential_operations
  TO api_center_retention;

DROP POLICY IF EXISTS cp_usage_records_retention ON apic_catalog.cp_usage_records;
CREATE POLICY cp_usage_records_retention ON apic_catalog.cp_usage_records TO api_center_retention USING (true);
DROP POLICY IF EXISTS cp_quota_counters_retention ON apic_catalog.cp_quota_counters;
CREATE POLICY cp_quota_counters_retention ON apic_catalog.cp_quota_counters TO api_center_retention USING (true);
DROP POLICY IF EXISTS cp_credential_operations_retention ON apic_catalog.cp_credential_operations;
CREATE POLICY cp_credential_operations_retention ON apic_catalog.cp_credential_operations TO api_center_retention USING (true);

-- The purge filters and orders on the dated column. Rows arrive in time order, so BRIN stays small.
CREATE INDEX IF NOT EXISTS cp_usage_records_created_brin ON apic_catalog.cp_usage_records USING brin (created_at);
CREATE INDEX IF NOT EXISTS cp_quota_counters_window_brin ON apic_catalog.cp_quota_counters USING brin (window_start);
CREATE INDEX IF NOT EXISTS cp_credential_operations_created_brin ON apic_catalog.cp_credential_operations USING brin (created_at);

COMMENT ON TABLE apic_catalog.cp_usage_records IS
  'retention=90d; one row per admitted application request, for usage reporting and quota idempotency';
COMMENT ON TABLE apic_catalog.cp_quota_counters IS
  'retention=62d; dated by window_start; the longest quota window is 31 days';
COMMENT ON TABLE apic_catalog.cp_credential_operations IS
  'retention=30d; idempotency receipts for key issuance';

COMMIT;
