BEGIN;
SET LOCAL lock_timeout = '10s';

-- The provider returns the same synthetic merchant ID for every sandbox onboarding.
ALTER TABLE shared_payment.linked_accounts DROP CONSTRAINT linked_accounts_environment_provider_account_id_key;
CREATE UNIQUE INDEX linked_accounts_provider_account_uidx
  ON shared_payment.linked_accounts (environment, provider_account_id)
  WHERE provider_account_id <> 'org_test_merchant';

CREATE TABLE shared_payment.linked_account_verification_sessions (
  linked_account_id text NOT NULL REFERENCES shared_payment.linked_accounts(id),
  session_id text NOT NULL,
  PRIMARY KEY (linked_account_id, session_id)
);
CREATE INDEX linked_account_verification_sessions_session_idx
  ON shared_payment.linked_account_verification_sessions (session_id, linked_account_id);

INSERT INTO shared_payment.linked_account_verification_sessions (linked_account_id, session_id)
SELECT id, verification_session_id FROM shared_payment.linked_accounts
WHERE verification_session_id IS NOT NULL;

ALTER TABLE shared_payment.linked_account_verification_sessions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON shared_payment.linked_account_verification_sessions TO payments_runtime;
CREATE POLICY linked_account_verification_sessions_runtime
  ON shared_payment.linked_account_verification_sessions TO payments_runtime USING (true) WITH CHECK (true);
COMMENT ON TABLE shared_payment.linked_account_verification_sessions IS 'Session identifiers only. Hosted verification URLs are never stored.';
COMMIT;
