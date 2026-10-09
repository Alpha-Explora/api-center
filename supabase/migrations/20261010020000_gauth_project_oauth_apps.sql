-- Google OAuth apps, one row per project and environment.
--
-- gauth resolves the calling project and environment from the headers the gateway sets
-- (X-APICenter-Project-Id and X-APICenter-Environment). A row with client_id and client_secret_ref
-- signs in with the team's own Google client. A row with neither uses APICenter's shared client.
-- redirect_uris lists every redirect URI gauth accepts for the project; the first entry is the default.
--
-- client_secret_ref is a Secret Manager version name. The secret value itself is never stored here.
--
-- shared_gauth.oauth_sessions, oauth_accounts and oauth_token_refs came from the initial migration.
-- No code read or wrote them, so they are dropped here.

create table if not exists shared_gauth.oauth_apps (
  project_id text not null,
  environment text not null,
  redirect_uris text[] not null,
  client_id text,
  client_secret_ref text,
  display_name text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oauth_apps_pkey primary key (project_id, environment),
  constraint oauth_apps_environment_check check (environment in ('test', 'live')),
  constraint oauth_apps_status_check check (status in ('active', 'disabled')),
  constraint oauth_apps_redirect_uris_check check (cardinality(redirect_uris) >= 1),
  constraint oauth_apps_client_id_check check (client_id is null or btrim(client_id) <> ''),
  constraint oauth_apps_client_pair_check check ((client_id is null) = (client_secret_ref is null)),
  constraint oauth_apps_secret_ref_check check (
    client_secret_ref is null or client_secret_ref ~ '^projects/[^/]+/secrets/[^/]+/versions/[^/]+$'
  )
);

drop table if exists shared_gauth.oauth_token_refs;
drop table if exists shared_gauth.oauth_accounts;
drop table if exists shared_gauth.oauth_sessions;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'shared_services_app') then
    grant usage on schema shared_gauth to shared_services_app;
    grant select on shared_gauth.oauth_apps to shared_services_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'gauth_runtime') then
    grant usage on schema shared_gauth to gauth_runtime;
    grant select on shared_gauth.oauth_apps to gauth_runtime;
  end if;
end $$;
