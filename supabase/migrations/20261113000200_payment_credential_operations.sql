BEGIN;
CREATE TABLE apic_governance.payment_credential_operations (
  operation_id uuid PRIMARY KEY,
  consumer_service_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','live')),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  key_id uuid NOT NULL REFERENCES apic_governance.payment_api_keys(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE apic_governance.payment_credential_operations ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON apic_governance.payment_credential_operations TO api_center_app;
CREATE POLICY payment_credential_operations_app ON apic_governance.payment_credential_operations TO api_center_app USING (true) WITH CHECK (true);
COMMENT ON TABLE apic_governance.payment_credential_operations IS 'Credential issuance receipts retained for key lifetime; never stores plaintext credentials';
COMMIT;
