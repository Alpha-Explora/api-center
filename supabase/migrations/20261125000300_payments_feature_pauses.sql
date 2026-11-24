BEGIN;
CREATE TABLE shared_payment.feature_pauses (
  environment text NOT NULL CHECK (environment IN ('test', 'live')),
  feature text NOT NULL CHECK (feature IN ('payouts_sending', 'payee_wallets', 'merchant_account')),
  paused boolean NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, feature)
);
ALTER TABLE shared_payment.feature_pauses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON shared_payment.feature_pauses TO payments_runtime;
CREATE POLICY feature_pauses_runtime ON shared_payment.feature_pauses TO payments_runtime USING (true) WITH CHECK (true);
COMMIT;
