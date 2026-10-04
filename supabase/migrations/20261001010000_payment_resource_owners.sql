CREATE TABLE IF NOT EXISTS shared_payment.resource_owners (
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test', 'live')),
  tribe_id text NOT NULL,
  consumer_service_id text NOT NULL,
  reference_id text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS payment_resource_owners_tribe_reference_idx
  ON shared_payment.resource_owners (environment, resource_type, tribe_id, reference_id)
  WHERE reference_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON shared_payment.resource_owners TO shared_services_app;
