BEGIN;
CREATE TABLE apic_catalog.service_credential_usage (
  service_id text NOT NULL,
  environment text NOT NULL CHECK(environment IN ('test','live')),
  version_name text NOT NULL,
  role text NOT NULL CHECK(role IN ('current','next')),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(service_id,environment,version_name,role)
);
ALTER TABLE apic_catalog.service_credential_usage ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON apic_catalog.service_credential_usage TO api_center_app;
CREATE POLICY service_credential_usage_app ON apic_catalog.service_credential_usage TO api_center_app USING(true) WITH CHECK(true);
COMMENT ON TABLE apic_catalog.service_credential_usage IS 'Service credential usage by Secret Manager version and slot; never stores secret hashes or plaintext';
COMMIT;
