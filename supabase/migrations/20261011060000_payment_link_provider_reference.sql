-- PayMongo assigns every payment link its own reference number, and a paid link payment reports only that
-- number. Storing it lets the webhook find the link that was paid. Callers choose reference_id, so the
-- webhook never matches on it: two projects may use the same reference_id, but never the same PayMongo number.
ALTER TABLE shared_payment.resource_owners
  ADD COLUMN IF NOT EXISTS provider_reference text;

CREATE UNIQUE INDEX IF NOT EXISTS payment_resource_owners_provider_reference_key
  ON shared_payment.resource_owners (environment, resource_type, provider_reference)
  WHERE provider_reference IS NOT NULL;

COMMENT ON COLUMN shared_payment.resource_owners.provider_reference IS
  'Reference number PayMongo assigned to the resource. Paid payment-link events are matched only on this value.';
