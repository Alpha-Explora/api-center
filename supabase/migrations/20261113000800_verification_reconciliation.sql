BEGIN;
ALTER TABLE apic_runtime.verification_runs DROP CONSTRAINT verification_runs_status_check;
ALTER TABLE apic_runtime.verification_runs ADD CONSTRAINT verification_runs_status_check CHECK(status IN ('queued','running','passed','failed','interrupted','uncertain'));
ALTER TABLE apic_runtime.verification_runs ADD COLUMN reconciled_by text, ADD COLUMN reconciliation_reason text, ADD COLUMN reconciled_at timestamptz;
DROP INDEX apic_runtime.verification_run_active_idx;
CREATE UNIQUE INDEX verification_run_active_idx ON apic_runtime.verification_runs(service_id,environment) WHERE status IN ('queued','running','uncertain');
COMMENT ON COLUMN apic_runtime.verification_runs.reconciliation_reason IS 'Operator evidence that an uncertain attempt was investigated; never grants readiness or retries a provider command';
COMMIT;
