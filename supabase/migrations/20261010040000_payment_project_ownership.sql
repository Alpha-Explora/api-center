-- Payment resources belong to a project, not only to a tribe.
--
-- Before this migration, shared_payment.resource_owners compared tribe_id alone, so a service in one
-- project could read or change payments that another project in the same tribe created. Ownership checks
-- and reference lookups now compare project_id and environment. The payment runtime takes project_id from
-- the X-APICenter-Project-ID header, which the gateway sets from the consumer service's registry placement.
--
-- There is no production payment data yet, so the columns are required without a backfill. The statements
-- fail on a database that still holds payment rows from before this change.

ALTER TABLE shared_payment.resource_owners
  ADD COLUMN IF NOT EXISTS project_id text NOT NULL;

ALTER TABLE shared_payment.payment_event_outbox
  ADD COLUMN IF NOT EXISTS project_id text NOT NULL;

DROP INDEX IF EXISTS shared_payment.payment_resource_owners_tribe_reference_idx;

CREATE INDEX IF NOT EXISTS payment_resource_owners_project_reference_idx
  ON shared_payment.resource_owners (environment, resource_type, project_id, reference_id)
  WHERE reference_id IS NOT NULL;
