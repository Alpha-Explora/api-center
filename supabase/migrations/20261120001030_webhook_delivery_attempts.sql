-- Delivery history for signed webhooks. The webhooks runtime (apps/webhooks) records one row per
-- delivery attempt it makes: the consumer's HTTP status, latency, attempt number and error. The data
-- belongs to that runtime, so it lives in the runtime's own schema under its own role, like
-- shared_email and shared_sms; the gateway reads it through the runtime's admin route.
-- The role may SELECT and INSERT only: attempts are append-only. Old rows are purged by retention.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'webhooks_runtime') THEN
    CREATE ROLE webhooks_runtime NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA shared_webhooks;
GRANT USAGE ON SCHEMA shared_webhooks TO webhooks_runtime;
GRANT USAGE ON SCHEMA shared_webhooks TO api_center_retention;

CREATE TABLE shared_webhooks.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id text NOT NULL CHECK (destination_id ~ '^dst_[a-z0-9]{24}$'),
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 200),
  event_type text CHECK (event_type IS NULL OR length(event_type) <= 200),
  attempt integer NOT NULL CHECK (attempt >= 1),
  outcome text NOT NULL CHECK (outcome IN ('delivered', 'rejected', 'unreachable', 'no_active_secret', 'disabled')),
  status_code integer CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  error text CHECK (error IS NULL OR length(error) <= 500),
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_destination_idx ON shared_webhooks.webhook_deliveries (destination_id, attempted_at DESC);
CREATE INDEX webhook_deliveries_attempted_at_idx ON shared_webhooks.webhook_deliveries (attempted_at);
COMMENT ON TABLE shared_webhooks.webhook_deliveries IS 'retention=30d; purged by attempted_at; one row per signed webhook delivery attempt (status, latency, error), never the body';

GRANT SELECT, INSERT ON shared_webhooks.webhook_deliveries TO webhooks_runtime;
GRANT SELECT, DELETE ON shared_webhooks.webhook_deliveries TO api_center_retention;

COMMIT;
