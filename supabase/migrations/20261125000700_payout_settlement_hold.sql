BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE shared_payment.payout_allocations ADD COLUMN held_at timestamptz;
UPDATE shared_payment.payout_allocations SET held_at = updated_at
  WHERE NOT template AND status IN ('held', 'released', 'pooled', 'paid');
ALTER TABLE shared_payment.project_payout_settings ADD COLUMN settlement_hold_days integer NOT NULL DEFAULT 7
  CHECK (settlement_hold_days BETWEEN 0 AND 30);
COMMIT;
