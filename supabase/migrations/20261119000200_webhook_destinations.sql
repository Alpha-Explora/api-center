-- Signed HTTPS webhooks as an event destination transport. A webhook destination's Pub/Sub
-- subscription pushes to APICenter's delivery service (push_endpoint), which signs each event and
-- POSTs it to the consumer's webhook_url. Its signing secrets live in Secret Manager
-- (apicenter-webhook-<id>), never in this table.
BEGIN;

ALTER TABLE apic_catalog.cp_event_destinations
  DROP CONSTRAINT cp_event_destinations_transport_check,
  ADD CONSTRAINT cp_event_destinations_transport_check CHECK (transport IN ('pubsub-push', 'webhook')),
  ADD COLUMN webhook_url text CHECK (webhook_url IS NULL OR (webhook_url ~ '^https://' AND length(webhook_url) <= 2048)),
  ADD COLUMN secret_rotated_at timestamptz,
  ADD CONSTRAINT cp_event_destinations_webhook_transport_check CHECK ((transport = 'webhook') = (webhook_url IS NOT NULL));

COMMIT;
