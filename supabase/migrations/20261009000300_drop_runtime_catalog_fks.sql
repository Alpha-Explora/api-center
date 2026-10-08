-- Runtime no longer holds foreign keys into the Catalog schema.
--
-- Seven apic_runtime columns referenced apic_catalog.services(id):
--   confluent_topics.owner_service_id        (on delete set null)
--   provisioning_jobs.service_id             (on delete set null)
--   health_snapshots.service_id              (on delete cascade)
--   smoke_test_runs.service_id               (on delete set null)
--   smoke_test_runs.tribe_service_id         (on delete set null)
--   usage_rollups.consumer_service_id        (on delete set null)
--   usage_rollups.target_service_id          (on delete set null)
--
-- Runtime and Catalog are separate bounded contexts. A foreign key let a Catalog delete reach into Runtime
-- history, for example cascading away every health snapshot of a service. The columns stay as plain service
-- identifiers, so Runtime history now outlives the service row it describes. The existing indexes are kept.
--
-- The loop drops whichever apic_runtime -> apic_catalog foreign keys exist, so the migration does not
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
      and n.nspname = 'apic_runtime'
      and rn.nspname = 'apic_catalog'
  loop
    execute format('alter table %I.%I drop constraint %I', fk.schema_name, fk.table_name, fk.constraint_name);
  end loop;
end $$;
