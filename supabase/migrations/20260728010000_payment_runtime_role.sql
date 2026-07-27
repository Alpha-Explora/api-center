-- Keep payment persistence on a dedicated database role.
-- Password provisioning remains an operator/Secret Manager concern and is
-- intentionally excluded from repository history.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shared_services_app') THEN
    CREATE ROLE shared_services_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA shared_payment TO shared_services_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA shared_payment TO shared_services_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA shared_payment TO shared_services_app;
