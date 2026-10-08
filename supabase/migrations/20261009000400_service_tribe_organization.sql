-- A tribe service must belong to the same organization as its tribe.
--
-- Organization -> tribe -> project -> service is the customer isolation boundary. Today the database enforces
-- tribe -> project -> service (services_project_fk), but a service row carries its own organization_id and
-- nothing ties it to the organization of the tribe that owns it. A service could be attached to one customer's
-- organization while its tribe and project belong to another.
--
-- tribes gets a unique (tribe_id, organization_id) pair so services can reference it. The foreign key uses
-- the default MATCH SIMPLE rule, so shared platform services (owner_tribe_id is null) are not constrained.
-- All tables are in apic_catalog, so no cross-schema key is introduced.

do $$
declare
  mismatched text;
begin
  select string_agg(
           s.service_id || ' (service organization ' || s.organization_id || ', tribe organization ' || t.organization_id || ')',
           ', ' order by s.service_id)
  into mismatched
  from apic_catalog.services s
  join apic_catalog.tribes t on t.tribe_id = s.owner_tribe_id
  where s.organization_id <> t.organization_id;

  if mismatched is not null then
    raise exception 'Service/tribe organization migration blocked: services whose organization differs from their tribe: %', mismatched;
  end if;
end $$;

alter table apic_catalog.tribes
  drop constraint if exists tribes_tribe_organization_key,
  add constraint tribes_tribe_organization_key unique (tribe_id, organization_id);

alter table apic_catalog.services
  drop constraint if exists services_tribe_organization_fk,
  add constraint services_tribe_organization_fk
    foreign key (owner_tribe_id, organization_id) references apic_catalog.tribes (tribe_id, organization_id);
