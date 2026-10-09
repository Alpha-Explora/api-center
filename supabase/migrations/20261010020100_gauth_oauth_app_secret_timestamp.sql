-- Record when a project's Google client secret last changed without storing its value.
alter table shared_gauth.oauth_apps
  add column if not exists client_secret_updated_at timestamptz;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'gauth_runtime') then
    grant insert, update, delete on shared_gauth.oauth_apps to gauth_runtime;
  end if;
end $$;
