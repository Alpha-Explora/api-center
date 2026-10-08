-- Governance no longer holds foreign keys into the Catalog schema.
--
-- 20261008000000_tribe_project_hierarchy.sql added four foreign keys from apic_governance tables to
-- apic_catalog.tribes and apic_catalog.projects. Governance and Catalog are separate bounded contexts and
-- must not be coupled at the database level: a foreign key lets one context's migrations, locks and
-- deletes affect the other.
--
-- Governance still validates every reference through the catalog-registry read port (TENANCY_DIRECTORY):
--   * quota policies:        tribe-quota-admin.controller.ts resolves the project and derives its tribe
--   * plan assignments:      tribe-plan-admin.controller.ts resolves the project and derives its tribe
--   * registration requests: registration-requests.service.ts resolves the project and derives its tribe
-- project_id and owner_tribe_id stay as plain identifiers, and the existing indexes are kept.
--
-- The loop drops whichever apic_governance -> apic_catalog foreign keys exist, so the migration does not
-- depend on constraint names and does nothing when they are already gone.

do $$
declare
  fk record;
begin
  for fk in
    select n.nspname as schema_name, t.relname as table_name, c.conname as constraint_name
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_class rt on rt.oid = c.confrelid
    join pg_namespace rn on rn.oid = rt.relnamespace
    where c.contype = 'f'
      and n.nspname = 'apic_governance'
      and rn.nspname = 'apic_catalog'
  loop
    execute format('alter table %I.%I drop constraint %I', fk.schema_name, fk.table_name, fk.constraint_name);
  end loop;
end $$;
