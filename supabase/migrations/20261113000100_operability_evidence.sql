BEGIN;
CREATE TABLE apic_runtime.verification_reports (
  run_id uuid PRIMARY KEY,
  service_row_id uuid NOT NULL, -- apic_catalog.services(id); validated by the catalog, not a cross-schema foreign key
  service_id text NOT NULL,
  project_id text NOT NULL, -- apic_catalog.projects(project_id); validated by the catalog, not a cross-schema foreign key
  environment text NOT NULL CHECK (environment IN ('test','live')),
  runner text NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  report jsonb NOT NULL CHECK (jsonb_typeof(report)='object' AND octet_length(report::text)<=16384)
);
CREATE INDEX verification_reports_lookup_idx ON apic_runtime.verification_reports(service_id,project_id,environment,observed_at DESC);
CREATE INDEX verification_reports_retention_idx ON apic_runtime.verification_reports(created_at);
COMMENT ON TABLE apic_runtime.verification_reports IS 'retention=30d; trusted runtime acceptance results; no credentials or request payloads';
ALTER TABLE apic_runtime.verification_reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON apic_runtime.verification_reports TO api_center_app;
CREATE POLICY verification_reports_app ON apic_runtime.verification_reports TO api_center_app USING (true) WITH CHECK (true);
GRANT SELECT,DELETE ON apic_runtime.verification_reports TO api_center_retention;
CREATE POLICY verification_reports_retention ON apic_runtime.verification_reports TO api_center_retention USING (true);
COMMIT;
