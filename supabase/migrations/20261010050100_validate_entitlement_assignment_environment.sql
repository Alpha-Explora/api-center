-- The existing check rejects new non-runtime environment values. Validate it
-- against existing assignments now that plan environments use test/live.
UPDATE apic_governance.entitlement_assignments
SET environment = 'live'
WHERE environment = 'prod';

ALTER TABLE apic_governance.entitlement_assignments
  VALIDATE CONSTRAINT entitlement_assignments_environment_check;
