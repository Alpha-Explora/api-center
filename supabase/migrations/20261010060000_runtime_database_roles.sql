-- One NOLOGIN database role per shared-service runtime. Each role can use only its own schema.
--
-- Privileges match what each runtime's code runs, so DELETE is granted only to gauth_runtime:
--   payments_runtime: SELECT, INSERT, UPDATE (apps/payments owner store and outbox dispatcher)
--   sms_runtime, otp_runtime: SELECT, INSERT, UPDATE (apps/sms and apps/otp Postgres stores)
--   email_runtime: SELECT, INSERT, UPDATE (no Postgres code yet; forward-looking)
--   gauth_runtime: SELECT, INSERT, UPDATE, DELETE (no Postgres code yet; forward-looking)
--
-- Default privileges give the same grants to tables and sequences that later migrations add to these
-- schemas. Login users are created outside the repository; see docs/operations/shared-service-database-roles.md.
-- No role is created for shared_geo, whose schema is removed separately.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payments_runtime') THEN
    CREATE ROLE payments_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'email_runtime') THEN
    CREATE ROLE email_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sms_runtime') THEN
    CREATE ROLE sms_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'otp_runtime') THEN
    CREATE ROLE otp_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gauth_runtime') THEN
    CREATE ROLE gauth_runtime NOLOGIN;
  END IF;
END
$$;

-- Retire shared_services_app. Remove its grants before dropping it. DROP ROLE also removes any login
-- user's membership in it, so those users must be re-created with IN ROLE payments_runtime before the
-- payment runtime and dispatcher are redeployed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shared_services_app') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA shared_payment, shared_sms, shared_otp, shared_email, shared_gauth FROM shared_services_app;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA shared_payment, shared_sms, shared_otp, shared_email, shared_gauth FROM shared_services_app;
    REVOKE ALL ON SCHEMA shared_payment, shared_sms, shared_otp, shared_email, shared_gauth FROM shared_services_app;
    DROP ROLE shared_services_app;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA shared_payment TO payments_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA shared_payment TO payments_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA shared_payment TO payments_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared_payment GRANT SELECT, INSERT, UPDATE ON TABLES TO payments_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared_payment GRANT USAGE, SELECT ON SEQUENCES TO payments_runtime;

GRANT USAGE ON SCHEMA shared_email TO email_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA shared_email TO email_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA shared_email TO email_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared_email GRANT SELECT, INSERT, UPDATE ON TABLES TO email_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared_email GRANT USAGE, SELECT ON SEQUENCES TO email_runtime;

GRANT USAGE ON SCHEMA shared_sms TO sms_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA shared_sms TO sms_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA shared_sms TO sms_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared_sms GRANT SELECT, INSERT, UPDATE ON TABLES TO sms_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared_sms GRANT USAGE, SELECT ON SEQUENCES TO sms_runtime;

GRANT USAGE ON SCHEMA shared_otp TO otp_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA shared_otp TO otp_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA shared_otp TO otp_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared_otp GRANT SELECT, INSERT, UPDATE ON TABLES TO otp_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared_otp GRANT USAGE, SELECT ON SEQUENCES TO otp_runtime;

GRANT USAGE ON SCHEMA shared_gauth TO gauth_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shared_gauth TO gauth_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA shared_gauth TO gauth_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared_gauth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gauth_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared_gauth GRANT USAGE, SELECT ON SEQUENCES TO gauth_runtime;
