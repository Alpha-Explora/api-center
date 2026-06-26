-- Allow the API Center runtime role to replace registry child rows during
-- Postgres-backed registry upserts. Parent services remain update-only, and
-- audit deletes stay denied.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'api_center_app') then
    raise exception 'Required runtime database role api_center_app is missing. Confirm role discovery before applying registry delete grants.';
  end if;
end $$;

grant delete on
  apic_catalog.service_environments,
  apic_catalog.service_routes,
  apic_catalog.service_scopes,
  apic_catalog.service_dependencies
to api_center_app;
