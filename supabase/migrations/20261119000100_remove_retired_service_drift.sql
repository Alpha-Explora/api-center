-- Brings an existing database to the shape a replay of these migrations builds, by removing what the
-- retired per-domain services (audit-evidence, governance, identity-access, platform-operations,
-- registry-catalog, and the first payment runtime) left behind. The baseline was recorded as already
-- applied on such databases, so its CREATE ... IF NOT EXISTS kept their older tables and grants.
-- On a database built from these migrations every statement is a no-op.
--
-- The one that matters most: payment_webhook_events kept the old environment column (NOT NULL, no
-- default) and lacked the (provider, provider_mode, provider_event_id) unique index, so every webhook
-- insert failed and PayMongo got a 502.
BEGIN;

-- Payment webhook receipts: provider_mode carries the environment; the old column and its views go.
DROP VIEW IF EXISTS
  shared_payment.live_payment_webhook_events,
  shared_payment.test_payment_webhook_events;
ALTER TABLE shared_payment.payment_webhook_events DROP COLUMN IF EXISTS environment;
CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_provider_provider_mode_provider_even_key
  ON shared_payment.payment_webhook_events USING btree (provider, provider_mode, provider_event_id);
COMMENT ON TABLE shared_payment.payment_webhook_events IS NULL;

-- Payment outbox: the topic is chosen when publishing; the old per-row routing columns go, including a
-- topic that defaulted to the test topic.
ALTER TABLE shared_payment.payment_event_outbox
  DROP COLUMN IF EXISTS topic,
  DROP COLUMN IF EXISTS contract_version,
  DROP COLUMN IF EXISTS correlation_id,
  DROP COLUMN IF EXISTS source_service;

-- Audit events: the old free-form columns go, and environment must be given by the writer.
ALTER TABLE apic_audit.audit_events
  DROP COLUMN IF EXISTS action_family,
  DROP COLUMN IF EXISTS actor,
  DROP COLUMN IF EXISTS message,
  DROP COLUMN IF EXISTS occurred_at,
  DROP COLUMN IF EXISTS payload,
  DROP COLUMN IF EXISTS severity,
  DROP COLUMN IF EXISTS shared_service_id,
  DROP COLUMN IF EXISTS tribe_service_id,
  DROP COLUMN IF EXISTS type,
  ALTER COLUMN environment DROP DEFAULT;

-- Tables no current code reads or writes. Payment keys and consumers live in apic_governance now.
DROP TABLE IF EXISTS
  apic_audit.audit_event_inbox,
  apic_audit.audit_event_outbox,
  apic_audit.evidence_packets,
  apic_catalog.registry_event_outbox,
  apic_governance.governance_event_inbox,
  apic_governance.governance_event_outbox,
  apic_runtime.gateway_rate_limit_counters,
  apic_runtime.promotion_evidence_bundles,
  apic_runtime.runtime_event_inbox,
  apic_runtime.runtime_event_outbox,
  shared_email.runtime_messages,
  shared_otp.runtime_challenges,
  shared_sms.runtime_messages,
  shared_payment.payment_api_keys,
  shared_payment.payment_consumer_services;

DROP SCHEMA IF EXISTS apicenter_migrations CASCADE;

-- Runtime roles never delete; old rows are purged by the retention role.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('shared_email', 'email_runtime'), ('shared_sms', 'sms_runtime'), ('shared_otp', 'otp_runtime'),
      ('apic_runtime', 'api_center_app')
    ) AS t(schema_name, role_name)
  LOOP
    EXECUTE format('REVOKE DELETE ON ALL TABLES IN SCHEMA %I FROM %I', target.schema_name, target.role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE DELETE ON TABLES FROM %I',
      target.schema_name, target.role_name);
  END LOOP;
END $$;

-- The retired services' roles own nothing, but DROP ROLE needs their grants and default privileges gone
-- first. DROP OWNED would do that, but on Supabase postgres holds ADMIN on these roles without their
-- privileges, which DROP OWNED requires, so the grants (all made by postgres) are revoked explicitly.
DO $$
DECLARE
  retired text;
  ns text;
BEGIN
  FOREACH retired IN ARRAY ARRAY[
    'audit_evidence_app', 'audit_evidence_runtime',
    'governance_app', 'governance_runtime',
    'identity_access_app', 'identity_access_runtime',
    'platform_operations_app', 'platform_operations_runtime',
    'registry_catalog_app', 'registry_catalog_runtime',
    'geo_runtime', 'payment_runtime'
  ] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = retired);
    FOR ns IN SELECT nspname FROM pg_namespace WHERE nspname ~ '^(apic_|shared_)' OR nspname = 'public' LOOP
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', ns, retired);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', ns, retired);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %I', ns, retired);
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', ns, retired);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE ALL ON TABLES FROM %I', ns, retired);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I', ns, retired);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE ALL ON FUNCTIONS FROM %I', ns, retired);
    END LOOP;
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM %I', current_database(), retired);
    EXECUTE format('DROP ROLE %I', retired);
  END LOOP;
END $$;

COMMIT;
