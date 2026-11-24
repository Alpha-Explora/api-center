-- APICenter-owned payment IDs (ADR-0010). Public payment IDs used to be the provider's IDs with a swapped
-- prefix. Every existing ID is replaced by an APICenter-minted one in this transaction, the provider's ID is
-- kept as data, and every stored copy is rewritten. Old IDs stop resolving; products were told beforehand
-- and can ask for their project's old-to-new mapping, kept here for 90 days.
BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM shared_payment.resource_owners WHERE resource_type NOT IN
      ('checkout', 'intent', 'payment', 'refund', 'customer', 'plan', 'payment_link', 'subscription', 'invoice')) THEN
    RAISE EXCEPTION 'resource_owners holds a resource type without a public ID prefix';
  END IF;
END $$;

ALTER TABLE shared_payment.resource_owners
  ADD COLUMN provider text NOT NULL DEFAULT 'paymongo',
  ADD COLUMN provider_resource_id text;

-- `${prefix}_` + 26 lowercase Crockford base32 characters, the format apps/payments/src/shared/payment-id-map.ts mints.
CREATE FUNCTION shared_payment.mint_public_id(prefix text) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog AS $$
DECLARE
  alphabet constant text := '0123456789abcdefghjkmnpqrstvwxyz';
  random_bytes bytea := decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex');
  body text := '';
BEGIN
  FOR i IN 0..25 LOOP
    body := body || substr(alphabet, (get_byte(random_bytes, i) % 32) + 1, 1);
  END LOOP;
  RETURN prefix || '_' || body;
END $$;

CREATE TABLE shared_payment.payment_id_replacements (
  environment text NOT NULL CHECK (environment IN ('test', 'live')),
  project_id text NOT NULL,
  resource_type text NOT NULL,
  old_id text NOT NULL,
  new_id text NOT NULL UNIQUE,
  replaced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, old_id)
);

INSERT INTO shared_payment.payment_id_replacements (environment, project_id, resource_type, old_id, new_id)
SELECT environment, project_id, resource_type, resource_id, shared_payment.mint_public_id(CASE resource_type
    WHEN 'checkout' THEN 'chk' WHEN 'intent' THEN 'pi' WHEN 'payment' THEN 'pay' WHEN 'refund' THEN 'ref'
    WHEN 'customer' THEN 'cus' WHEN 'plan' THEN 'plan' WHEN 'payment_link' THEN 'pl'
    WHEN 'subscription' THEN 'sub' WHEN 'invoice' THEN 'inv' END)
FROM shared_payment.resource_owners;

-- The old public ID was derived from the provider's ID; reverse that derivation to keep the provider's ID.
UPDATE shared_payment.resource_owners AS owner SET
  provider_resource_id = CASE
    WHEN owner.resource_type = 'checkout' AND starts_with(owner.resource_id, 'chk_') THEN 'cs_' || substr(owner.resource_id, 5)
    WHEN owner.resource_type = 'payment_link' AND starts_with(owner.resource_id, 'pl_') THEN 'link_' || substr(owner.resource_id, 4)
    WHEN owner.resource_type = 'invoice' AND starts_with(owner.resource_id, 'inv_') THEN 'in_' || substr(owner.resource_id, 5)
    ELSE owner.resource_id END,
  resource_id = replacement.new_id
FROM shared_payment.payment_id_replacements AS replacement
WHERE replacement.environment = owner.environment AND replacement.old_id = owner.resource_id;

CREATE UNIQUE INDEX payment_resource_owners_provider_resource_key ON shared_payment.resource_owners
  (environment, provider, resource_type, provider_resource_id) WHERE provider_resource_id IS NOT NULL;

-- Rewrite every stored copy of an old ID. IDs are matched as whole JSON strings, never as substrings.
DO $$
DECLARE
  replacement record;
  old_json text;
  new_json text;
BEGIN
  FOR replacement IN SELECT environment, old_id, new_id FROM shared_payment.payment_id_replacements LOOP
    old_json := to_jsonb(replacement.old_id)::text;
    new_json := to_jsonb(replacement.new_id)::text;
    UPDATE shared_payment.resource_owners
      SET snapshot = replace(snapshot::text, old_json, new_json)::jsonb
      WHERE environment = replacement.environment AND strpos(snapshot::text, old_json) > 0;
    UPDATE shared_payment.payment_event_outbox
      SET aggregate_id = CASE WHEN aggregate_id = replacement.old_id THEN replacement.new_id ELSE aggregate_id END,
          payload = replace(payload::text, old_json, new_json)::jsonb
      WHERE environment = replacement.environment
        AND (aggregate_id = replacement.old_id OR strpos(payload::text, old_json) > 0);
    UPDATE shared_payment.payout_allocations
      SET resource_id = CASE WHEN resource_id = replacement.old_id THEN replacement.new_id ELSE resource_id END,
          payment_id = CASE WHEN payment_id = replacement.old_id THEN replacement.new_id ELSE payment_id END
      WHERE environment = replacement.environment
        AND (resource_id = replacement.old_id OR payment_id = replacement.old_id);
    UPDATE shared_payment.payee_adjustments SET source_refund_id = replacement.new_id
      WHERE environment = replacement.environment AND source_refund_id = replacement.old_id;
  END LOOP;
END $$;

-- A paid checkout's payment snapshot named the provider's internal intent; keep it only when it is an owned intent.
UPDATE shared_payment.resource_owners SET snapshot = snapshot - 'paymentIntentId'
WHERE resource_type = 'payment' AND snapshot ? 'paymentIntentId'
  AND snapshot->>'paymentIntentId' !~ '^pi_[0-9a-hjkmnp-tv-z]{26}$';

-- Stored idempotent responses would replay old IDs. Unresolved reservations hold no response and stay:
-- removing one could let a retry charge twice.
DELETE FROM apic_governance.payment_idempotency_keys WHERE response IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM shared_payment.resource_owners
      WHERE resource_id !~ '^(chk|pi|pay|ref|cus|plan|pl|sub|inv)_[0-9a-hjkmnp-tv-z]{26}$') THEN
    RAISE EXCEPTION 'a payment resource still has a provider-derived ID';
  END IF;
  IF EXISTS (SELECT 1 FROM shared_payment.payment_id_replacements replacement
      JOIN shared_payment.resource_owners owner ON owner.environment = replacement.environment
      WHERE strpos(owner.snapshot::text, to_jsonb(replacement.old_id)::text) > 0) THEN
    RAISE EXCEPTION 'a payment snapshot still holds a replaced ID';
  END IF;
  IF EXISTS (SELECT 1 FROM shared_payment.payment_id_replacements replacement
      JOIN shared_payment.payment_event_outbox event ON event.environment = replacement.environment
      WHERE event.aggregate_id = replacement.old_id OR strpos(event.payload::text, to_jsonb(replacement.old_id)::text) > 0) THEN
    RAISE EXCEPTION 'a payment event still holds a replaced ID';
  END IF;
  IF EXISTS (SELECT 1 FROM shared_payment.payment_id_replacements replacement
      JOIN shared_payment.payout_allocations allocation ON allocation.environment = replacement.environment
      WHERE allocation.resource_id = replacement.old_id OR allocation.payment_id = replacement.old_id) THEN
    RAISE EXCEPTION 'a payout allocation still holds a replaced ID';
  END IF;
  IF EXISTS (SELECT 1 FROM shared_payment.payment_id_replacements replacement
      JOIN shared_payment.payee_adjustments adjustment ON adjustment.environment = replacement.environment
      WHERE adjustment.source_refund_id = replacement.old_id) THEN
    RAISE EXCEPTION 'a payee adjustment still holds a replaced ID';
  END IF;
END $$;

ALTER TABLE shared_payment.payment_id_replacements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON shared_payment.payment_id_replacements TO payments_runtime;
CREATE POLICY payment_id_replacements_runtime ON shared_payment.payment_id_replacements
  FOR SELECT TO payments_runtime USING (true);
GRANT SELECT, DELETE ON shared_payment.payment_id_replacements TO api_center_retention;
CREATE POLICY payment_id_replacements_retention ON shared_payment.payment_id_replacements
  TO api_center_retention USING (true);
CREATE INDEX payment_id_replacements_replaced_brin ON shared_payment.payment_id_replacements USING brin (replaced_at);

COMMENT ON COLUMN shared_payment.resource_owners.provider_resource_id IS 'The payment provider''s ID for this resource; never returned to callers';
COMMENT ON TABLE shared_payment.payment_id_replacements IS 'retention=90d; old provider-derived payment IDs and their APICenter replacements, for products that stored old IDs';
COMMIT;
