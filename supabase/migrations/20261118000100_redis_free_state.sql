-- State that lived in Redis moves to Postgres: runtime idempotency claims and per-recipient send
-- windows in each runtime's own schema; the gateway's refresh tokens (new apic_identity schema, owned
-- by the auth context) and payment idempotency (apic_governance, owned by payments).
-- Runtime roles keep exactly SELECT, INSERT and UPDATE on their schema (no DELETE): released and
-- expired rows are overwritten in place. Old rows are purged by the retention role.
BEGIN;

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES ('shared_email', 'email_runtime'), ('shared_sms', 'sms_runtime'), ('shared_otp', 'otp_runtime')) AS t(schema_name, role_name)
  LOOP
    EXECUTE format($sql$
      CREATE TABLE %1$I.idempotency_keys (
        key text PRIMARY KEY,
        fingerprint text NOT NULL,
        state text NOT NULL CHECK (state IN ('processing', 'completed', 'unknown', 'released')),
        response jsonb,
        lease_until timestamptz,
        unknown_since timestamptz,
        expires_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )$sql$, target.schema_name);
    EXECUTE format('CREATE INDEX idempotency_keys_expiry_idx ON %I.idempotency_keys (expires_at) WHERE expires_at IS NOT NULL', target.schema_name);
    EXECUTE format($sql$COMMENT ON TABLE %I.idempotency_keys IS 'retention=7d; purged by expires_at; idempotency claims for send operations; unknown outcomes are kept until reconciled'$sql$, target.schema_name);

    EXECUTE format($sql$
      CREATE TABLE %1$I.rate_limit_windows (
        key text PRIMARY KEY,
        count integer NOT NULL CHECK (count > 0),
        reset_at timestamptz NOT NULL
      )$sql$, target.schema_name);
    EXECUTE format('CREATE INDEX rate_limit_windows_reset_idx ON %I.rate_limit_windows (reset_at)', target.schema_name);
    EXECUTE format($sql$COMMENT ON TABLE %I.rate_limit_windows IS 'retention=1d; purged by reset_at; fixed-window send limits per recipient'$sql$, target.schema_name);

    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.idempotency_keys, %I.rate_limit_windows TO %I', target.schema_name, target.schema_name, target.role_name);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO api_center_retention', target.schema_name);
    EXECUTE format('GRANT SELECT, DELETE ON %I.idempotency_keys, %I.rate_limit_windows TO api_center_retention', target.schema_name, target.schema_name);
  END LOOP;
END
$$;

-- The auth context's own schema; until now it kept no rows.
CREATE SCHEMA apic_identity;
GRANT USAGE ON SCHEMA apic_identity TO api_center_app;
GRANT USAGE ON SCHEMA apic_identity TO api_center_retention;

CREATE TABLE apic_identity.refresh_tokens (
  jti text PRIMARY KEY,
  subject text NOT NULL,
  record jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_subject_idx ON apic_identity.refresh_tokens (subject);
CREATE INDEX refresh_tokens_expiry_idx ON apic_identity.refresh_tokens (expires_at);
COMMENT ON TABLE apic_identity.refresh_tokens IS 'retention=1d; purged by expires_at; legacy service refresh tokens (metadata only, never the token)';
ALTER TABLE apic_identity.refresh_tokens ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON apic_identity.refresh_tokens TO api_center_app;
CREATE POLICY refresh_tokens_app ON apic_identity.refresh_tokens TO api_center_app USING (true) WITH CHECK (true);
GRANT SELECT, DELETE ON apic_identity.refresh_tokens TO api_center_retention;
CREATE POLICY refresh_tokens_retention ON apic_identity.refresh_tokens TO api_center_retention USING (true);

CREATE TABLE apic_governance.payment_idempotency_keys (
  storage_key text PRIMARY KEY,
  fingerprint text NOT NULL,
  response jsonb,
  lease_until timestamptz,
  unknown_since timestamptz,
  -- NULL until a response is stored: an unresolved reservation must never expire into a new charge.
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_idempotency_keys_expiry_idx ON apic_governance.payment_idempotency_keys (expires_at) WHERE expires_at IS NOT NULL;
COMMENT ON TABLE apic_governance.payment_idempotency_keys IS 'retention=1d; purged by expires_at; payment mutation replay records; unresolved reservations are kept';
ALTER TABLE apic_governance.payment_idempotency_keys ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON apic_governance.payment_idempotency_keys TO api_center_app;
CREATE POLICY payment_idempotency_keys_app ON apic_governance.payment_idempotency_keys TO api_center_app USING (true) WITH CHECK (true);
GRANT SELECT, DELETE ON apic_governance.payment_idempotency_keys TO api_center_retention;
CREATE POLICY payment_idempotency_keys_retention ON apic_governance.payment_idempotency_keys TO api_center_retention USING (true);

COMMIT;
