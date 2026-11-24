BEGIN;
ALTER TABLE shared_payment.project_payout_settings ADD COLUMN require_payee_verification boolean NOT NULL DEFAULT false;
COMMIT;
