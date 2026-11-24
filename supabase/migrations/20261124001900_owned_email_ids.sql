-- APICenter-owned email message IDs (ADR-0010). After a send, the store used to overwrite APICenter's local ID
-- (msg_…) with the email provider's ID, so the public message ID was the provider's. Every existing ID is
-- replaced by an APICenter-minted one in this transaction, the provider's ID is kept as data for delivery
-- callbacks, and delivery events follow. Old IDs stop resolving.
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE shared_email.email_messages ADD COLUMN provider_message_id text;

-- `${prefix}_` + 26 lowercase Crockford base32 characters, the format @apicenter/runtime mintId produces.
CREATE FUNCTION shared_email.mint_public_id(prefix text) RETURNS text
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

CREATE TEMPORARY TABLE email_id_replacements ON COMMIT DROP AS
  SELECT message_id AS old_id, shared_email.mint_public_id('eml') AS new_id FROM shared_email.email_messages;

-- A message ID that is not APICenter's local msg_ form was overwritten with the provider's ID at send time.
UPDATE shared_email.email_messages AS message SET
  provider_message_id = CASE WHEN message.message_id ~ '^msg_[0-9a-f]{32}$' THEN NULL ELSE message.message_id END,
  message_id = replacement.new_id
FROM email_id_replacements AS replacement WHERE replacement.old_id = message.message_id;

UPDATE shared_email.email_delivery_events AS event SET message_id = replacement.new_id
FROM email_id_replacements AS replacement WHERE replacement.old_id = event.message_id;

CREATE UNIQUE INDEX email_messages_provider_message_key ON shared_email.email_messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Stored responses would replay old IDs. Claims still processing or with an unknown outcome stay: removing one
-- could let a retry send twice.
DELETE FROM shared_email.idempotency_keys WHERE state = 'completed';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM shared_email.email_messages WHERE message_id !~ '^eml_[0-9a-hjkmnp-tv-z]{26}$') THEN
    RAISE EXCEPTION 'an email message still has a provider or local ID as its public ID';
  END IF;
  IF EXISTS (SELECT 1 FROM shared_email.email_delivery_events event
      JOIN email_id_replacements replacement ON replacement.old_id = event.message_id) THEN
    RAISE EXCEPTION 'an email delivery event still holds a replaced ID';
  END IF;
END $$;

COMMENT ON COLUMN shared_email.email_messages.provider_message_id IS 'The email provider''s message ID; matched by delivery callbacks, never returned to callers';
COMMIT;
