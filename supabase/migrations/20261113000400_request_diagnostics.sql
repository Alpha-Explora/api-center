BEGIN;
CREATE TABLE apic_runtime.request_diagnostics (
  request_id uuid PRIMARY KEY,
  correlation_id text NOT NULL CHECK(length(correlation_id)<=128),
  service_id text,
  project_id text,
  environment text CHECK(environment IN ('test','live')),
  route text NOT NULL CHECK(length(route)<=300),
  method text NOT NULL,
  status_code integer NOT NULL CHECK(status_code BETWEEN 100 AND 599),
  error_code text,
  failure_stage text CHECK(failure_stage IN ('authentication','authorization','quota','routing','runtime','provider','unknown')),
  duration_ms integer NOT NULL CHECK(duration_ms>=0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_diagnostics_scope_idx ON apic_runtime.request_diagnostics(service_id,environment,created_at DESC);
CREATE INDEX request_diagnostics_correlation_idx ON apic_runtime.request_diagnostics(correlation_id,environment,created_at DESC);
CREATE INDEX request_diagnostics_retention_idx ON apic_runtime.request_diagnostics(created_at);
COMMENT ON TABLE apic_runtime.request_diagnostics IS 'retention=30d; redacted diagnostic envelopes; no query strings, recipients or payloads';
ALTER TABLE apic_runtime.request_diagnostics ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON apic_runtime.request_diagnostics TO api_center_app;
CREATE POLICY request_diagnostics_app ON apic_runtime.request_diagnostics TO api_center_app USING(true) WITH CHECK(true);
GRANT SELECT,DELETE ON apic_runtime.request_diagnostics TO api_center_retention;
CREATE POLICY request_diagnostics_retention ON apic_runtime.request_diagnostics TO api_center_retention USING(true);
COMMIT;
