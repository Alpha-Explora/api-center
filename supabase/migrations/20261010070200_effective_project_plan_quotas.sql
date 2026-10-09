-- Plan definitions are code-owned. Keep assignment history, but remove duplicate catalogue storage.
-- This rollout starts without production data, so no catalogue or assignment backfill is performed.
DROP VIEW IF EXISTS api_center_ops.tribe_plan_definitions;

ALTER TABLE apic_governance.entitlement_assignments
  DROP CONSTRAINT IF EXISTS entitlement_assignments_plan_key_fkey,
  DROP CONSTRAINT IF EXISTS entitlement_assignments_project_fk;

DROP TABLE IF EXISTS apic_governance.entitlement_plans;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM apic_governance.entitlement_assignments
    WHERE status = 'active'
    GROUP BY owner_tribe_id, project_id, environment
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one active plan assignment per project and environment: duplicate active assignments exist';
  END IF;
END
$$;

CREATE UNIQUE INDEX entitlement_assignments_one_active_owner_project_env_uidx
  ON apic_governance.entitlement_assignments (owner_tribe_id, project_id, environment)
  WHERE status = 'active';
