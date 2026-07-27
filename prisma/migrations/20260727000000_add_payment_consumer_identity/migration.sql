CREATE TABLE IF NOT EXISTS apic_governance.payment_consumer_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_tribe_id text NOT NULL,
  consumer_service_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test', 'live')),
  event_endpoint_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_tribe_id, consumer_service_id, environment)
);

CREATE TABLE IF NOT EXISTS apic_governance.payment_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_service_id uuid NOT NULL REFERENCES apic_governance.payment_consumer_services(id) ON DELETE CASCADE,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY['payments:read', 'payments:write'],
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE IF NOT EXISTS apic_governance.payment_idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_tribe_id text NOT NULL,
  consumer_service_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test', 'live')),
  operation_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_sha256 text NOT NULL,
  response_status integer,
  response_content_type text,
  response_body jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_tribe_id, consumer_service_id, environment, operation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS payment_idempotency_records_expiry_idx
  ON apic_governance.payment_idempotency_records (expires_at);

