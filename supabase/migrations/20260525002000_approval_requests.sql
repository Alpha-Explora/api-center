create table if not exists api_center_ops.approval_requests (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  target_id text,
  target_environment text not null,
  status text not null default 'pending',
  before jsonb not null,
  after jsonb not null,
  risk_level text not null,
  reason text not null,
  requested_by text not null,
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_action_type_check check (
    action_type in (
      'quota.enforce',
      'secret.rotate',
      'topic.provision',
      's3_sink.include_topic',
      'service.register_live',
      'service.retire',
      'plan.assign_live'
    )
  ),
  constraint approval_requests_status_check check (
    status in ('pending', 'approved', 'rejected')
  ),
  constraint approval_requests_risk_level_check check (
    risk_level in ('low', 'medium', 'high', 'critical')
  )
);

create index if not exists approval_requests_status_created_idx
  on api_center_ops.approval_requests (status, created_at desc);

create index if not exists approval_requests_action_env_idx
  on api_center_ops.approval_requests (action_type, target_environment);

create index if not exists approval_requests_target_idx
  on api_center_ops.approval_requests (target_id);
