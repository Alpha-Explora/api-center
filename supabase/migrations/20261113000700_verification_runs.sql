BEGIN;
CREATE TABLE apic_runtime.verification_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id text NOT NULL,
  project_id text NOT NULL REFERENCES apic_catalog.projects(project_id),
  environment text NOT NULL CHECK(environment IN ('test','live')),
  fingerprint text NOT NULL,
  gateway_revision text NOT NULL,
  requested_by text NOT NULL,
  claimed_by text,
  status text NOT NULL CHECK(status IN ('queued','running','passed','failed','interrupted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX verification_run_active_idx ON apic_runtime.verification_runs(service_id,environment) WHERE status IN ('queued','running');
CREATE INDEX verification_run_lookup_idx ON apic_runtime.verification_runs(service_id,environment,created_at DESC);
CREATE INDEX verification_runs_retention_idx ON apic_runtime.verification_runs(created_at);
COMMENT ON TABLE apic_runtime.verification_runs IS 'retention=30d; queued and claimed verification attempts; unfinished runs are interrupted, never retried as provider writes';
ALTER TABLE apic_runtime.verification_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON apic_runtime.verification_runs TO api_center_app;
CREATE POLICY verification_runs_app ON apic_runtime.verification_runs TO api_center_app USING(true) WITH CHECK(true);
GRANT SELECT,DELETE ON apic_runtime.verification_runs TO api_center_retention;
CREATE POLICY verification_runs_retention ON apic_runtime.verification_runs TO api_center_retention USING(true);
COMMIT;
