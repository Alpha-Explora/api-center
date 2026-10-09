-- Organization membership: which email addresses may use the management console for an organization.
--
-- A row grants an email a role inside one organization. Emails are stored lowercase. Platform admins
-- (PLATFORM_ADMIN_EMAILS on the gateway) are not rows here; they act as admin in every organization.
-- Only the gateway reads and writes this table, through the API Center runtime role.

create table if not exists apic_catalog.organization_members (
  organization_id uuid not null references apic_catalog.organizations(id) on delete cascade,
  email text not null
    constraint organization_members_email_check check (email = lower(email) and length(email) between 3 and 320),
  role text not null
    constraint organization_members_role_check check (role in ('admin', 'operator', 'observer')),
  created_by text,
  created_at timestamptz not null default now(),
  constraint organization_members_pkey primary key (organization_id, email)
);

create index if not exists organization_members_email_idx on apic_catalog.organization_members(email);

-- Supabase API roles must not reach membership data directly.
revoke all on apic_catalog.organization_members from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'api_center_app') then
    grant select, insert, update, delete on apic_catalog.organization_members to api_center_app;
  end if;
end $$;
