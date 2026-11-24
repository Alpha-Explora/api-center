BEGIN;
CREATE TABLE shared_payment.project_feature_settings (
  environment text NOT NULL CHECK (environment IN ('test', 'live')),
  project_id text NOT NULL,
  feature text NOT NULL CHECK (feature IN ('payouts_sending', 'payee_wallets')),
  enabled boolean NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, project_id, feature),
  CHECK (feature <> 'payee_wallets' OR environment = 'test')
);
ALTER TABLE shared_payment.project_feature_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON shared_payment.project_feature_settings TO payments_runtime;
CREATE POLICY project_feature_settings_runtime ON shared_payment.project_feature_settings
  TO payments_runtime USING (true) WITH CHECK (true);
COMMIT;
