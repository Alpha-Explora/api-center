-- An environment suspended by an APICenter operator stays suspended until an operator resumes it.
-- Before, any project admin could resume an environment the platform had suspended (for abuse or
-- non-payment), because the environment did not record who suspended it.
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE apic_catalog.cp_environments
  ADD COLUMN IF NOT EXISTS suspended_by_platform boolean NOT NULL DEFAULT false;

ALTER TABLE apic_catalog.cp_environments DROP CONSTRAINT IF EXISTS cp_environments_platform_suspension_check;
ALTER TABLE apic_catalog.cp_environments
  ADD CONSTRAINT cp_environments_platform_suspension_check CHECK (NOT suspended_by_platform OR status = 'suspended');

COMMIT;
