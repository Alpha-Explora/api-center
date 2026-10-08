-- Tribe -> project -> service hierarchy (single cutover).
--
-- Tribes and projects become first-class catalog rows. Every tribe-type service belongs to exactly one
-- project, and its owner tribe is derived from that project. A composite foreign key
-- (project_id, owner_tribe_id) -> projects(project_id, tribe_id) makes a service's tribe impossible to
-- disagree with its project. Shared platform services have no project.
--
-- Backfill rules:
--   * one tribe per distinct owner: services.owner_tribe_id, or service_id for legacy tribe roots, plus every
--     owner_tribe_id already referenced by quota policies, plan assignments, and pending registration requests
--     (decided requests are history and do not create tribes);
--   * one "<tribe>-default" project per tribe, holding every existing service of that tribe;
--   * existing quota policies keep project_id = null, which now means "tribe-wide ceiling", so no limit tightens;
--   * existing plan assignments and registration requests move to the tribe's default project.

insert into apic_catalog.organizations (slug, name)
values ('default', 'Default Organization')
on conflict (slug) do nothing;

create table if not exists apic_catalog.tribes (
  tribe_id text primary key
    constraint tribes_tribe_id_check check (tribe_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  organization_id uuid not null references apic_catalog.organizations(id),
  name text not null,
  description text,
  status text not null default 'active'
    constraint tribes_status_check check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apic_catalog.projects (
  project_id text primary key
    constraint projects_project_id_check check (project_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  tribe_id text not null references apic_catalog.tribes(tribe_id),
  name text not null,
  description text,
  cost_center text,
  status text not null default 'active'
    constraint projects_status_check check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_project_tribe_unique unique (project_id, tribe_id)
);

create index if not exists projects_tribe_status_idx on apic_catalog.projects(tribe_id, status);

-- A tribe id has one customer organization. Do not silently attach legacy rows from
-- multiple organizations to whichever organization happens to appear first.
do $$
begin
  if exists (
    select 1
    from apic_catalog.services s
    where s.service_type = 'tribe'
    group by coalesce(s.owner_tribe_id, s.service_id)
    having count(distinct s.organization_id) > 1
  ) then
    raise exception 'Tribe/project migration blocked: a tribe owner spans multiple organizations';
  end if;
end $$;
-- Every owner that will become a tribe must be a valid id. Only live sources count: services, quota
-- policies, plan assignments, and requests still waiting for a decision. Rejected or applied requests are
-- history and do not create tribes. Fail with the offending ids instead of a raw constraint error.
do $$
declare
  bad_owners text;
begin
  select string_agg(distinct owner_id, ', ' order by owner_id)
  into bad_owners
  from (
    select coalesce(s.owner_tribe_id, s.service_id) as owner_id
    from apic_catalog.services s where s.service_type = 'tribe'
    union
    select q.owner_tribe_id from apic_governance.quota_policies q
    union
    select e.owner_tribe_id from apic_governance.entitlement_assignments e
    union
    select r.owner_tribe_id
    from apic_governance.registry_change_requests r
    where r.status = 'pending' and coalesce(r.manifest ->> 'serviceType', 'tribe') <> 'shared'
  ) owners
  where owner_id is not null and owner_id !~ '^[a-z0-9][a-z0-9-]{0,63}$';

  if bad_owners is not null then
    raise exception 'Tribe/project migration blocked: owner ids are not valid tribe ids (lowercase letters, digits, hyphens; max 64): %', bad_owners;
  end if;
end $$;

with owners as (
  select coalesce(s.owner_tribe_id, s.service_id) as tribe_id, s.organization_id
  from apic_catalog.services s
  where s.service_type = 'tribe'
  union all
  select q.owner_tribe_id, null::uuid from apic_governance.quota_policies q
  union all
  select e.owner_tribe_id, null::uuid from apic_governance.entitlement_assignments e
  union all
  select r.owner_tribe_id, null::uuid
  from apic_governance.registry_change_requests r
  where r.status = 'pending' and coalesce(r.manifest ->> 'serviceType', 'tribe') <> 'shared'
)
insert into apic_catalog.tribes (tribe_id, organization_id, name)
select
  o.tribe_id,
  coalesce(
    (array_agg(o.organization_id order by o.organization_id) filter (where o.organization_id is not null))[1],
    (select id from apic_catalog.organizations where slug = 'default')
  ),
  coalesce(
    (select s.name from apic_catalog.services s where s.service_id = o.tribe_id order by s.registered_at limit 1),
    o.tribe_id
  )
from owners o
where o.tribe_id is not null
group by o.tribe_id
on conflict (tribe_id) do nothing;

insert into apic_catalog.projects (project_id, tribe_id, name, description)
select t.tribe_id || '-default', t.tribe_id, t.name, 'Default project created by the tribe/project hierarchy migration'
from apic_catalog.tribes t
on conflict (project_id) do nothing;

-- Services --------------------------------------------------------------------------------------------
alter table apic_catalog.services add column if not exists project_id text;

update apic_catalog.services
set owner_tribe_id = coalesce(owner_tribe_id, service_id),
    project_id = coalesce(owner_tribe_id, service_id) || '-default'
where service_type = 'tribe' and project_id is null;

update apic_catalog.services
set owner_tribe_id = null, project_id = null
where service_type = 'shared';

alter table apic_catalog.services
  drop constraint if exists services_project_fk,
  add constraint services_project_fk
    foreign key (project_id, owner_tribe_id) references apic_catalog.projects(project_id, tribe_id),
  drop constraint if exists services_project_placement_check,
  add constraint services_project_placement_check
    check ((service_type = 'tribe' and project_id is not null and owner_tribe_id is not null)
        or (service_type = 'shared' and project_id is null and owner_tribe_id is null));

create index if not exists services_project_idx on apic_catalog.services(project_id);

-- Quota policies: project budgets plus tribe-wide ceilings ---------------------------------------------
alter table apic_governance.quota_policies add column if not exists project_id text;

alter table apic_governance.quota_policies
  drop constraint if exists quota_policies_tribe_fk,
  add constraint quota_policies_tribe_fk
    foreign key (owner_tribe_id) references apic_catalog.tribes(tribe_id),
  drop constraint if exists quota_policies_project_fk,
  add constraint quota_policies_project_fk
    foreign key (project_id, owner_tribe_id) references apic_catalog.projects(project_id, tribe_id);

create index if not exists quota_policies_project_status_idx
  on apic_governance.quota_policies(project_id, status);

alter table apic_runtime.quota_evaluations add column if not exists project_id text;
create index if not exists quota_evaluations_environment_project_created_idx
  on apic_runtime.quota_evaluations(environment, project_id, created_at desc);

-- Plan assignments are per project and environment -----------------------------------------------------
alter table apic_governance.entitlement_assignments add column if not exists project_id text;

update apic_governance.entitlement_assignments
set project_id = owner_tribe_id || '-default'
where project_id is null;

alter table apic_governance.entitlement_assignments
  alter column project_id set not null,
  drop constraint if exists entitlement_assignments_project_fk,
  add constraint entitlement_assignments_project_fk
    foreign key (project_id, owner_tribe_id) references apic_catalog.projects(project_id, tribe_id);

create index if not exists entitlement_assignments_project_env_status_idx
  on apic_governance.entitlement_assignments(project_id, environment, status);

-- Registration requests name the target project; shared-service requests have neither tribe nor project --
alter table apic_governance.registry_change_requests add column if not exists project_id text;
alter table apic_governance.registry_change_requests alter column owner_tribe_id drop not null;

update apic_governance.registry_change_requests
set owner_tribe_id = null, project_id = null
where coalesce(manifest ->> 'serviceType', 'tribe') = 'shared';

update apic_governance.registry_change_requests
set project_id = coalesce(nullif(manifest ->> 'projectId', ''), owner_tribe_id || '-default')
where project_id is null and owner_tribe_id is not null and status = 'pending';

-- Decided requests are history. Link them to their project when it exists; otherwise leave the project empty.
update apic_governance.registry_change_requests r
set project_id = p.project_id
from apic_catalog.projects p
where r.project_id is null
  and r.status <> 'pending'
  and r.owner_tribe_id is not null
  and p.tribe_id = r.owner_tribe_id
  and p.project_id = coalesce(nullif(r.manifest ->> 'projectId', ''), r.owner_tribe_id || '-default');

do $$
begin
  if exists (
    select 1
    from apic_governance.registry_change_requests r
    where r.status = 'pending'
      and coalesce(r.manifest ->> 'serviceType', 'tribe') = 'tribe'
      and (
        r.owner_tribe_id is null
        or r.project_id is null
        or (
          nullif(r.manifest ->> 'projectId', '') is not null
          and nullif(r.manifest ->> 'projectId', '') <> r.project_id
        )
        or not exists (
          select 1
          from apic_catalog.projects p
          where p.project_id = r.project_id
            and p.tribe_id = r.owner_tribe_id
        )
      )
  ) then
    raise exception 'Tribe/project migration blocked: a registration request has a missing or conflicting project placement';
  end if;
end $$;

alter table apic_governance.registry_change_requests
  drop constraint if exists registry_change_requests_project_fk,
  add constraint registry_change_requests_project_fk
    foreign key (project_id, owner_tribe_id) references apic_catalog.projects(project_id, tribe_id),
  drop constraint if exists registry_change_requests_placement_check,
  add constraint registry_change_requests_placement_check
    check (
      status <> 'pending'
      or (coalesce(manifest ->> 'serviceType', 'tribe') = 'shared'
        and project_id is null and owner_tribe_id is null)
      or (coalesce(manifest ->> 'serviceType', 'tribe') = 'tribe'
        and project_id is not null and owner_tribe_id is not null)
    );

create index if not exists registry_change_requests_project_idx
  on apic_governance.registry_change_requests(project_id);

-- Privileges ----------------------------------------------------------------------------------------------
revoke all on apic_catalog.tribes, apic_catalog.projects from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'api_center_app') then
    grant select, insert, update on apic_catalog.tribes, apic_catalog.projects to api_center_app;
  end if;
end $$;
