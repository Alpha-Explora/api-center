-- No legacy plan assignments need conversion in the clean-start rollout. Validate the runtime-only constraint.
ALTER TABLE apic_governance.entitlement_assignments
  VALIDATE CONSTRAINT entitlement_assignments_environment_check;
