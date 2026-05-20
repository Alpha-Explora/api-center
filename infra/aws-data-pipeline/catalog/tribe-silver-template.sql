-- Replace <tribe_id> and <domain_event_type> after data classification and semantic approval.
CREATE DATABASE IF NOT EXISTS silver_<tribe_id>;

CREATE OR REPLACE VIEW silver_<tribe_id>.<domain_event_type> AS
SELECT
  tribe_id,
  source_service_id,
  event_type,
  occurred_at,
  ingested_at,
  year,
  month,
  day,
  hour,
  raw_record
FROM common_silver.tribe_event_envelope
WHERE environment = 'prod'
  AND tribe_id = '<tribe_id>'
  AND event_type = '<domain_event_type>';
