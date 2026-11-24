BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE shared_payment.linked_accounts
  ADD COLUMN payee_id text REFERENCES shared_payment.payees(id),
  ADD COLUMN onboarding_application_id text,
  ADD COLUMN onboarding_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT linked_accounts_payee_application_check
    CHECK ((payee_id IS NULL AND onboarding_application_id IS NULL)
      OR (payee_id IS NOT NULL AND onboarding_application_id IS NOT NULL AND environment = 'test'));

ALTER TABLE shared_payment.linked_accounts DROP CONSTRAINT linked_accounts_check;
ALTER TABLE shared_payment.linked_accounts ADD CONSTRAINT linked_accounts_provider_account_id_check CHECK (
  provider_account_id ~ '^org_[A-Za-z0-9]+$'
  OR (environment = 'test' AND payee_id IS NULL AND provider_account_id = 'org_test_merchant')
  OR (environment = 'test' AND payee_id IS NOT NULL AND provider_account_id = 'org_test_consumer')
);

DROP INDEX shared_payment.linked_accounts_open_project_idx;
CREATE UNIQUE INDEX linked_accounts_open_project_idx ON shared_payment.linked_accounts (environment, project_id)
  WHERE payee_id IS NULL AND status <> 'declined' AND closed_at IS NULL;
CREATE UNIQUE INDEX linked_accounts_open_payee_idx ON shared_payment.linked_accounts (environment, payee_id)
  WHERE payee_id IS NOT NULL AND status <> 'declined' AND closed_at IS NULL;

DROP INDEX shared_payment.linked_accounts_provider_account_uidx;
CREATE UNIQUE INDEX linked_accounts_provider_account_uidx
  ON shared_payment.linked_accounts (environment, provider_account_id)
  WHERE provider_account_id NOT IN ('org_test_merchant', 'org_test_consumer');

ALTER TABLE shared_payment.payees ADD COLUMN linked_wallet_onboarding_id text REFERENCES shared_payment.linked_accounts(id);
COMMIT;
