BEGIN;
CREATE TABLE apic_catalog.service_credential_operations (
  operation_id uuid PRIMARY KEY,
  service_id text NOT NULL,
  environment text NOT NULL CHECK(environment IN ('test','live')),
  action text NOT NULL CHECK(action IN ('start','verify','revoke-old')),
  actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 200),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
  status text NOT NULL CHECK(status IN ('running','completed','failed','uncertain')),
  version_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX service_credential_operation_active_idx ON apic_catalog.service_credential_operations(service_id,environment) WHERE status IN ('running','uncertain');
ALTER TABLE apic_catalog.service_credential_operations ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON apic_catalog.service_credential_operations TO api_center_app;
CREATE POLICY service_credential_operations_app ON apic_catalog.service_credential_operations TO api_center_app USING(true) WITH CHECK(true);
COMMENT ON TABLE apic_catalog.service_credential_operations IS 'Durable lifecycle and recovery receipts; no credential hashes or plaintext';
COMMIT;
