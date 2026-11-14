-- Control plane rebuild, slice 6: live environments.
-- A live environment starts in 'provisioning'. It can hold applications, grants and
-- configuration, but serves no requests and issues no credentials until it is activated with a
-- single-use 'environment.activate_live' approval.
BEGIN;

ALTER TABLE apic_catalog.cp_environments DROP CONSTRAINT cp_environments_status_check;
ALTER TABLE apic_catalog.cp_environments
  ADD CONSTRAINT cp_environments_status_check CHECK (status IN ('provisioning','active','suspended'));
ALTER TABLE apic_catalog.cp_environments ADD COLUMN activated_at timestamptz;
ALTER TABLE apic_catalog.cp_environments ADD COLUMN activated_by text;
ALTER TABLE apic_catalog.cp_environments ADD COLUMN activation_approval_id text;
-- A test environment never needs activation; a live one is active only after an approval.
ALTER TABLE apic_catalog.cp_environments
  ADD CONSTRAINT cp_environments_live_activation_check
  CHECK (kind = 'test' OR status = 'provisioning' OR activation_approval_id IS NOT NULL);

-- The application code already uses quota.increase and payments.live_access; the baseline
-- constraint omitted them, so PostgreSQL rejected those approval requests.
ALTER TABLE apic_governance.approval_requests DROP CONSTRAINT approval_requests_action_type_check;
ALTER TABLE apic_governance.approval_requests
  ADD CONSTRAINT approval_requests_action_type_check CHECK (action_type IN (
    'quota.increase','quota.enforce','secret.rotate','topic.provision','s3_sink.include_topic',
    'service.register_live','service.retire','plan.assign_live','payments.live_access',
    'environment.activate_live'
  ));

COMMIT;
