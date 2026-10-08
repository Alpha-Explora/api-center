-- Claim leases for the payment event dispatcher.
--
-- The dispatcher (apps/payments/src/events/paymentEventDispatcher.js) claims pending outbox rows in
-- bounded batches with FOR UPDATE SKIP LOCKED. A claim token gates both acknowledgements, so a job that
-- stalls cannot overwrite a row that a later job has claimed. A claim older than the lease is reclaimed,
-- and a row that reaches max_attempts moves to quarantine instead of retrying forever.
--
-- owner_tribe_id, consumer_service_id, reference_id and the quarantine columns already exist
-- (20260728000000_payment_runtime_contract.sql). The shared_services_app role already holds
-- select, insert and update on the table (20260728010000_payment_runtime_role.sql).

ALTER TABLE shared_payment.payment_event_outbox
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 8;

CREATE INDEX IF NOT EXISTS payment_outbox_claimable_idx
  ON shared_payment.payment_event_outbox (status, available_at, created_at);
