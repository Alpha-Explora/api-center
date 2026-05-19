create table if not exists api_center_ops.service_registration_requests (
  id uuid primary key default gen_random_uuid(),
  service_id text not null,
  owner_tribe_id text not null,
  status text not null default 'pending',
  manifest jsonb not null,
  validation_report jsonb not null default '{}'::jsonb,
  requested_by text,
  approved_by text,
  rejected_by text,
  rejection_reason text,
  applied_service_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  applied_at timestamptz
);

create index if not exists service_registration_requests_status_created_idx
  on api_center_ops.service_registration_requests (status, created_at desc);

create index if not exists service_registration_requests_service_idx
  on api_center_ops.service_registration_requests (service_id);

create index if not exists service_registration_requests_owner_idx
  on api_center_ops.service_registration_requests (owner_tribe_id);

alter table api_center_ops.service_registration_requests
  drop constraint if exists service_registration_requests_status_check;

alter table api_center_ops.service_registration_requests
  add constraint service_registration_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'applied'));
