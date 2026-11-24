BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE shared_payment.linked_accounts (
  id text PRIMARY KEY CHECK (id ~ '^lac_[A-Za-z0-9]+$'),
  environment text NOT NULL CHECK (environment IN ('test', 'live')),
  organization_id text NOT NULL,
  project_id text NOT NULL,
  provider_account_id text CHECK (provider_account_id ~ '^org_[A-Za-z0-9]+$'
    OR (environment = 'test' AND provider_account_id = 'org_test_merchant')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'created', 'details_submitted',
    'verification_pending', 'verification_failed', 'manual_review', 'activation_pending', 'active', 'declined')),
  verification_attempts integer NOT NULL DEFAULT 0 CHECK (verification_attempts BETWEEN 0 AND 3),
  verification_expires_at timestamptz,
  verification_session_id text,
  wallet_only boolean NOT NULL DEFAULT false,
  activation_requested boolean NOT NULL DEFAULT false,
  payment_methods_requested boolean NOT NULL DEFAULT false,
  decline_reason text,
  create_started_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, id),
  UNIQUE (environment, provider_account_id)
);

CREATE UNIQUE INDEX linked_accounts_open_project_idx ON shared_payment.linked_accounts (environment, project_id)
  WHERE status <> 'declined' AND closed_at IS NULL;

CREATE INDEX linked_accounts_project_history_idx ON shared_payment.linked_accounts (environment, project_id, created_at DESC);

CREATE TABLE shared_payment.linked_account_events (
  environment text NOT NULL,
  provider_event_id text NOT NULL,
  linked_account_id text NOT NULL,
  type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, provider_event_id),
  FOREIGN KEY (environment, linked_account_id) REFERENCES shared_payment.linked_accounts(environment, id)
);

CREATE TABLE shared_payment.project_linked_account_settings (
  environment text NOT NULL CHECK (environment IN ('test', 'live')),
  project_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, project_id)
);

ALTER TABLE shared_payment.merchant_accounts
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  ADD COLUMN linked_account_id text,
  ADD FOREIGN KEY (environment, linked_account_id) REFERENCES shared_payment.linked_accounts(environment, id);

ALTER TABLE shared_payment.resource_owners
  ADD COLUMN merchant_account_id text NOT NULL DEFAULT 'parent',
  ADD FOREIGN KEY (environment, merchant_account_id) REFERENCES shared_payment.merchant_accounts(environment, id);

DROP INDEX shared_payment.payment_resource_owners_provider_reference_key;
CREATE UNIQUE INDEX payment_resource_owners_provider_reference_key ON shared_payment.resource_owners
  (environment, merchant_account_id, resource_type, provider_reference) WHERE provider_reference IS NOT NULL;

CREATE TABLE shared_payment.collection_account_routes (
  environment text NOT NULL,
  project_id text NOT NULL,
  application_id text NOT NULL,
  request_key text NOT NULL CHECK (request_key ~ '^[a-f0-9]{64}$'),
  merchant_account_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, project_id, application_id, request_key),
  FOREIGN KEY (environment, merchant_account_id) REFERENCES shared_payment.merchant_accounts(environment, id)
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['linked_accounts', 'linked_account_events', 'project_linked_account_settings',
    'collection_account_routes'] LOOP
    EXECUTE format('ALTER TABLE shared_payment.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON shared_payment.%I TO payments_runtime', table_name);
    EXECUTE format('CREATE POLICY %I ON shared_payment.%I TO payments_runtime USING (true) WITH CHECK (true)',
      table_name || '_runtime', table_name);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA shared_payment TO api_center_retention;
GRANT SELECT, DELETE ON shared_payment.collection_account_routes TO api_center_retention;
CREATE POLICY collection_account_routes_retention ON shared_payment.collection_account_routes
  TO api_center_retention USING (true);
CREATE INDEX collection_account_routes_created_brin ON shared_payment.collection_account_routes USING brin (created_at);

COMMENT ON TABLE shared_payment.linked_accounts IS 'Linked merchant onboarding state; no ID images, no secrets, no forwarded personal details';
COMMENT ON TABLE shared_payment.linked_account_events IS 'Account lifecycle event identifiers for deduplication; no event bodies or personal details';
COMMENT ON TABLE shared_payment.collection_account_routes IS 'retention=7d; keeps collection retries on the originally chosen merchant account';
COMMIT;
