-- Store queryable payment facts beside the provider snapshot so teams and finance can list records
-- without calling PayMongo. Amounts remain integer minor units; non-monetary resources may be null.
ALTER TABLE shared_payment.resource_owners
  ADD COLUMN IF NOT EXISTS amount_minor bigint,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'shared_payment.resource_owners'::regclass
      AND conname = 'payment_resource_owners_status_lowercase_check'
  ) THEN
    ALTER TABLE shared_payment.resource_owners
      ADD CONSTRAINT payment_resource_owners_status_lowercase_check
      CHECK (status IS NULL OR status = LOWER(status));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payment_resource_owners_project_environment_type_created_idx
  ON shared_payment.resource_owners (project_id, environment, resource_type, created_at DESC, resource_id DESC);
CREATE INDEX IF NOT EXISTS payment_resource_owners_project_environment_created_idx
  ON shared_payment.resource_owners (project_id, environment, created_at DESC, resource_type DESC, resource_id DESC);
CREATE INDEX IF NOT EXISTS payment_resource_owners_project_environment_status_created_idx
  ON shared_payment.resource_owners (project_id, environment, status, created_at DESC, resource_type DESC, resource_id DESC);
