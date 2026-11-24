BEGIN;

ALTER TABLE shared_payment.payees
  ADD COLUMN verified_by text CHECK (length(verified_by) BETWEEN 1 AND 200),
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN verification_method text CHECK (verification_method IN ('government_id', 'in_person', 'third_party', 'other')),
  ADD COLUMN verification_reference text CHECK (length(verification_reference) BETWEEN 1 AND 120),
  ADD CONSTRAINT payees_verification_complete CHECK (
    (verified_by IS NULL AND verified_at IS NULL AND verification_method IS NULL AND verification_reference IS NULL)
    OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND verification_method IS NOT NULL)
  );

COMMENT ON COLUMN shared_payment.payees.verification_reference IS 'Project record reference only; no identity document numbers';
COMMIT;
