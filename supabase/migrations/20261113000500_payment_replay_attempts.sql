BEGIN;
CREATE TABLE shared_payment.payment_replay_attempts (
  attempt_id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES shared_payment.payment_event_outbox(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  status text NOT NULL CHECK(status IN ('running','published','failed','uncertain')),
  actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 200),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,operation_id)
);
CREATE UNIQUE INDEX payment_replay_active_idx ON shared_payment.payment_replay_attempts(event_id) WHERE status IN ('running','uncertain');
CREATE INDEX payment_replay_event_idx ON shared_payment.payment_replay_attempts(event_id,created_at DESC);
ALTER TABLE shared_payment.payment_replay_attempts ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON shared_payment.payment_replay_attempts TO payments_runtime;
CREATE POLICY payment_replay_runtime ON shared_payment.payment_replay_attempts TO payments_runtime USING(true) WITH CHECK(true);
COMMENT ON TABLE shared_payment.payment_replay_attempts IS 'Audited replay receipts; retained with original outbox event; contains no provider payload or secret';
COMMIT;
