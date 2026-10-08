-- Audit events are append-only for the application role.
--
-- 20260627151932_add_environment_runtime_constraints.sql ends with a blanket
--   grant select, insert, update, delete on all tables in schema ... apic_audit ... to api_center_app
-- which undid the earlier "revoke delete on all tables in schema apic_audit" in
-- 20260625162216_enterprise_control_plane_schemas.sql. As a result the runtime role could edit or erase
-- audit history. No application code updates or deletes audit rows.
--
-- Retention purges must run as a separate privileged role, not as api_center_app.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'api_center_app') then
    revoke update, delete, truncate on all tables in schema apic_audit from api_center_app;
  end if;
end $$;
