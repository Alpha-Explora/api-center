-- APICenter-owned SMS message IDs (ADR-0010). The public message ID used to be the SMS provider's. Every
-- existing ID is replaced by an APICenter-minted one in this transaction, the provider's ID is kept as data
-- for delivery callbacks, and delivery events follow. Old IDs stop resolving.
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE shared_sms.sms_messages
  ADD COLUMN provider text NOT NULL DEFAULT 'twilio',
  ADD COLUMN provider_message_id text;

-- `${prefix}_` + 26 lowercase Crockford base32 characters, the format @apicenter/runtime mintId produces.
CREATE FUNCTION shared_sms.mint_public_id(prefix text) RETURNS text
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

CREATE TEMPORARY TABLE sms_id_replacements ON COMMIT DROP AS
  SELECT message_id AS old_id, shared_sms.mint_public_id('sms') AS new_id FROM shared_sms.sms_messages;

UPDATE shared_sms.sms_messages AS message SET provider_message_id = message.message_id, message_id = replacement.new_id
FROM sms_id_replacements AS replacement WHERE replacement.old_id = message.message_id;

UPDATE shared_sms.sms_delivery_events AS event SET message_id = replacement.new_id
FROM sms_id_replacements AS replacement WHERE replacement.old_id = event.message_id;

CREATE UNIQUE INDEX sms_messages_provider_message_key ON shared_sms.sms_messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Stored responses would replay old IDs. Claims still processing or with an unknown outcome stay: removing one
-- could let a retry send twice.
DELETE FROM shared_sms.idempotency_keys WHERE state = 'completed';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM shared_sms.sms_messages WHERE message_id !~ '^sms_[0-9a-hjkmnp-tv-z]{26}$') THEN
    RAISE EXCEPTION 'an SMS message still has a provider ID as its public ID';
  END IF;
  IF EXISTS (SELECT 1 FROM shared_sms.sms_delivery_events event
      WHERE NOT EXISTS (SELECT 1 FROM shared_sms.sms_messages message WHERE message.message_id = event.message_id)
        AND EXISTS (SELECT 1 FROM sms_id_replacements replacement WHERE replacement.old_id = event.message_id)) THEN
    RAISE EXCEPTION 'an SMS delivery event still holds a replaced ID';
  END IF;
END $$;

COMMENT ON COLUMN shared_sms.sms_messages.provider_message_id IS 'The SMS provider''s message ID; matched by delivery callbacks, never returned to callers';
COMMIT;
