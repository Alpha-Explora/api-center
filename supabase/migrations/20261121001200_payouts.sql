-- Payouts: payees, their shares of payments (allocations), pooled payouts sent from a PayMongo wallet,
-- and the transfer attempts behind each payout. Every row names the merchant account whose wallet
-- received the money, so a project can later move to a PayMongo child account with a mapping row.
-- See docs/adr/0008-project-payouts-through-resolved-merchant-accounts.md.
BEGIN;

CREATE TABLE shared_payment.merchant_accounts (
  environment text NOT NULL CHECK (environment IN ('test','live')),
  id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('parent','child')),
  wallet_account_number text CHECK (wallet_account_number ~ '^[0-9]{6,20}$'),
  wallet_account_name text CHECK (length(wallet_account_name) BETWEEN 1 AND 200),
  low_float_alert_centavos bigint NOT NULL DEFAULT 0 CHECK (low_float_alert_centavos >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, id),
  CHECK ((kind = 'parent' AND id = 'parent') OR (kind = 'child' AND id ~ '^org_[A-Za-z0-9]+$'))
);
INSERT INTO shared_payment.merchant_accounts (environment, id, kind) VALUES ('test','parent','parent'), ('live','parent','parent');

CREATE TABLE shared_payment.project_merchant_accounts (
  environment text NOT NULL CHECK (environment IN ('test','live')),
  project_id text NOT NULL,
  effective_from timestamptz NOT NULL,
  merchant_account_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, project_id, effective_from),
  FOREIGN KEY (environment, merchant_account_id) REFERENCES shared_payment.merchant_accounts(environment, id)
);

CREATE TABLE shared_payment.project_payout_settings (
  environment text NOT NULL CHECK (environment IN ('test','live')),
  project_id text NOT NULL,
  schedule_weekday smallint CHECK (schedule_weekday BETWEEN 0 AND 6),
  schedule_hour smallint CHECK (schedule_hour BETWEEN 0 AND 23),
  immediate boolean NOT NULL,
  threshold_centavos bigint CHECK (threshold_centavos >= 0),
  on_demand_minimum bigint CHECK (on_demand_minimum >= 0),
  on_demand_daily_cap bigint CHECK (on_demand_daily_cap >= 0),
  scheduled_fee_bearer text NOT NULL CHECK (scheduled_fee_bearer IN ('platform','payee')),
  cash_out_fee_bearer text NOT NULL CHECK (cash_out_fee_bearer IN ('platform','payee')),
  minimum_payout bigint NOT NULL CHECK (minimum_payout >= 0),
  transfer_fee bigint NOT NULL CHECK (transfer_fee >= 0),
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, project_id),
  CHECK ((schedule_weekday IS NULL) = (schedule_hour IS NULL)),
  CHECK ((on_demand_minimum IS NULL) = (on_demand_daily_cap IS NULL)),
  CHECK (on_demand_daily_cap IS NULL OR on_demand_daily_cap >= on_demand_minimum)
);

CREATE TABLE shared_payment.payees (
  id text PRIMARY KEY CHECK (id ~ '^pye_[A-Za-z0-9]+$'),
  environment text NOT NULL CHECK (environment IN ('test','live')),
  organization_id text NOT NULL,
  project_id text NOT NULL,
  consumer_service_id text NOT NULL,
  external_ref text NOT NULL CHECK (length(external_ref) BETWEEN 1 AND 120),
  legal_name text NOT NULL CHECK (length(legal_name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  destination jsonb,
  destination_hold_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, project_id, external_ref)
);
CREATE INDEX payees_project_idx ON shared_payment.payees (environment, project_id, created_at DESC, id DESC);

CREATE TABLE shared_payment.payout_allocations (
  id text PRIMARY KEY CHECK (id ~ '^pal_[A-Za-z0-9]+$'),
  environment text NOT NULL CHECK (environment IN ('test','live')),
  organization_id text NOT NULL,
  project_id text NOT NULL,
  consumer_service_id text NOT NULL,
  merchant_account_id text NOT NULL,
  payee_id text NOT NULL REFERENCES shared_payment.payees(id),
  resource_type text NOT NULL CHECK (resource_type IN ('intent','checkout','payment_link')),
  resource_id text NOT NULL,
  reference_id text NOT NULL,
  -- A payment link's allocations are templates: each paid payment copies them with its payment_id.
  template boolean NOT NULL DEFAULT false,
  payment_id text,
  amount bigint NOT NULL CHECK (amount > 0),
  gross_amount bigint NOT NULL CHECK (gross_amount >= amount),
  status text NOT NULL CHECK (status IN ('awaiting_payment','held','released','pooled','paid','cancelled')),
  payout_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (environment, merchant_account_id) REFERENCES shared_payment.merchant_accounts(environment, id),
  CHECK (NOT template OR (status = 'awaiting_payment' AND payment_id IS NULL)),
  CHECK ((status IN ('pooled','paid')) = (payout_id IS NOT NULL)),
  CHECK (amount <= 5000000)
);
CREATE INDEX payout_allocations_resource_idx ON shared_payment.payout_allocations (environment, resource_type, resource_id);
CREATE INDEX payout_allocations_payment_idx ON shared_payment.payout_allocations (environment, payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX payout_allocations_released_idx ON shared_payment.payout_allocations (environment, merchant_account_id, payee_id, created_at)
  WHERE status = 'released';
CREATE INDEX payout_allocations_payee_idx ON shared_payment.payout_allocations (payee_id, status);
-- One copy of a link's allocation per paid payment, so a replayed webhook cannot hold twice.
CREATE UNIQUE INDEX payout_allocations_payment_copy_uidx ON shared_payment.payout_allocations (environment, resource_id, payment_id, payee_id)
  WHERE resource_type = 'payment_link' AND NOT template;
-- One share per payee per intent or checkout, and one template per payee per link, so a retried create stores each once.
CREATE UNIQUE INDEX payout_allocations_resource_payee_uidx ON shared_payment.payout_allocations (environment, resource_type, resource_id, payee_id)
  WHERE resource_type <> 'payment_link' OR template;
CREATE INDEX payout_allocations_payout_idx ON shared_payment.payout_allocations (payout_id) WHERE payout_id IS NOT NULL;

CREATE TABLE shared_payment.payee_adjustments (
  id text PRIMARY KEY CHECK (id ~ '^padj_[A-Za-z0-9]+$'),
  environment text NOT NULL CHECK (environment IN ('test','live')),
  project_id text NOT NULL,
  merchant_account_id text NOT NULL,
  payee_id text NOT NULL REFERENCES shared_payment.payees(id),
  amount bigint NOT NULL CHECK (amount <> 0),
  reason text NOT NULL CHECK (reason IN ('clawback','manual')),
  source_allocation_id text REFERENCES shared_payment.payout_allocations(id),
  source_refund_id text,
  payout_id text,
  -- Set when the share a clawback came from is cancelled, so the payee is not charged for money they never received.
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (environment, merchant_account_id) REFERENCES shared_payment.merchant_accounts(environment, id)
);
CREATE INDEX payee_adjustments_open_idx ON shared_payment.payee_adjustments (environment, merchant_account_id, payee_id)
  WHERE payout_id IS NULL AND voided_at IS NULL;
CREATE INDEX payee_adjustments_payout_idx ON shared_payment.payee_adjustments (payout_id) WHERE payout_id IS NOT NULL;
-- A refund claws back each allocation once, however often its webhook is delivered.
CREATE UNIQUE INDEX payee_adjustments_refund_uidx ON shared_payment.payee_adjustments (source_allocation_id, source_refund_id)
  WHERE source_refund_id IS NOT NULL;

CREATE TABLE shared_payment.payouts (
  id text PRIMARY KEY CHECK (id ~ '^po_[A-Za-z0-9]+$'),
  environment text NOT NULL CHECK (environment IN ('test','live')),
  organization_id text NOT NULL,
  project_id text NOT NULL,
  consumer_service_id text NOT NULL,
  merchant_account_id text NOT NULL,
  payee_id text NOT NULL REFERENCES shared_payment.payees(id),
  gross bigint NOT NULL CHECK (gross >= 0),
  fee bigint NOT NULL CHECK (fee >= 0),
  net bigint NOT NULL CHECK (net > 0),
  trigger text NOT NULL CHECK (trigger IN ('schedule','release','cash_out')),
  status text NOT NULL CHECK (status IN ('draft','submitting','pending','unknown','paid','failed','needs_review')),
  destination jsonb NOT NULL,
  failure_code text,
  resolution_note text CHECK (length(resolution_note) BETWEEN 1 AND 500),
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (environment, merchant_account_id) REFERENCES shared_payment.merchant_accounts(environment, id)
);
CREATE INDEX payouts_project_idx ON shared_payment.payouts (environment, project_id, created_at DESC, id DESC);
CREATE INDEX payouts_payee_idx ON shared_payment.payouts (payee_id, trigger, created_at DESC);
CREATE INDEX payouts_open_idx ON shared_payment.payouts (environment, status) WHERE status IN ('draft','submitting','pending','unknown','needs_review');

ALTER TABLE shared_payment.payout_allocations
  ADD CONSTRAINT payout_allocations_payout_fk FOREIGN KEY (payout_id) REFERENCES shared_payment.payouts(id);
ALTER TABLE shared_payment.payee_adjustments
  ADD CONSTRAINT payee_adjustments_payout_fk FOREIGN KEY (payout_id) REFERENCES shared_payment.payouts(id);

CREATE TABLE shared_payment.payout_transfer_attempts (
  id text PRIMARY KEY CHECK (id ~ '^pta_[A-Za-z0-9]+$'),
  environment text NOT NULL CHECK (environment IN ('test','live')),
  payout_id text NOT NULL REFERENCES shared_payment.payouts(id),
  reference_number text NOT NULL CHECK (reference_number ~ '^[A-Z0-9]{1,64}$'),
  callback_token text NOT NULL CHECK (callback_token ~ '^[A-Za-z0-9_-]{43}$'),
  provider_transfer_id text,
  provider_status text CHECK (provider_status IN ('pending','succeeded','failed')),
  fee bigint CHECK (fee >= 0),
  failure_code text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, reference_number),
  UNIQUE (callback_token),
  UNIQUE (environment, provider_transfer_id)
);
-- A payout has at most one attempt that may still move money.
CREATE UNIQUE INDEX payout_transfer_attempts_live_uidx ON shared_payment.payout_transfer_attempts (payout_id)
  WHERE provider_status IS DISTINCT FROM 'failed';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['merchant_accounts','project_merchant_accounts','project_payout_settings','payees',
    'payout_allocations','payee_adjustments','payouts','payout_transfer_attempts'] LOOP
    EXECUTE format('ALTER TABLE shared_payment.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON shared_payment.%I TO payments_runtime', t);
    EXECUTE format('CREATE POLICY %I ON shared_payment.%I TO payments_runtime USING (true) WITH CHECK (true)', t || '_runtime', t);
  END LOOP;
END $$;

COMMENT ON TABLE shared_payment.merchant_accounts IS 'PayMongo merchant accounts whose wallet funds payouts; wallet account number and name only, no secrets';
COMMENT ON TABLE shared_payment.project_merchant_accounts IS 'Which merchant account acts for a project from a point in time; read only by the merchant-account resolver';
COMMENT ON TABLE shared_payment.project_payout_settings IS 'Per-project payout policy: weekly schedule, cash-out limits and fee bearers; no secrets';
COMMENT ON TABLE shared_payment.payees IS 'Project-scoped payout recipients and their current destination; no secrets';
COMMENT ON TABLE shared_payment.payout_allocations IS 'A payee''s share of one payment, held until the project releases it; no secrets';
COMMENT ON TABLE shared_payment.payee_adjustments IS 'Signed ledger entries against a payee, such as refund clawbacks; no secrets';
COMMENT ON TABLE shared_payment.payouts IS 'One pooled transfer to one payee from one merchant account; no secrets';
COMMENT ON TABLE shared_payment.payout_transfer_attempts IS 'Provider transfers for a payout, keyed by our reference number; the callback token is a lookup key, not a credential to PayMongo';
COMMIT;
