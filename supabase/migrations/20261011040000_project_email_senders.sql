create table shared_email.project_senders (
  project_id text not null,
  environment text not null check (environment in ('test', 'live')),
  from_address text not null check (length(btrim(from_address)) between 1 and 320),
  daily_limit integer check (daily_limit is null or daily_limit > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, environment)
);

comment on table shared_email.project_senders is 'Project email sender configuration; one row per project and environment.';

grant select, insert, update on shared_email.project_senders to email_runtime;
