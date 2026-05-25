CREATE TABLE IF NOT EXISTS api_center_ops.tribe_api_quota_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_tribe_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all',
  target_service_id TEXT,
  window_seconds INTEGER NOT NULL CHECK (window_seconds > 0),
  max_requests INTEGER NOT NULL CHECK (max_requests > 0),
  burst_requests INTEGER CHECK (burst_requests IS NULL OR burst_requests >= max_requests),
  mode TEXT NOT NULL DEFAULT 'observe' CHECK (mode IN ('observe', 'enforce')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  reason TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (scope IN ('all', 'shared', 'tribe', 'kafka_publish'))
);

CREATE INDEX IF NOT EXISTS tribe_quota_policies_owner_status_idx
  ON api_center_ops.tribe_api_quota_policies (owner_tribe_id, status);

CREATE INDEX IF NOT EXISTS tribe_quota_policies_scope_target_idx
  ON api_center_ops.tribe_api_quota_policies (scope, target_service_id);

CREATE TABLE IF NOT EXISTS api_center_ops.tribe_api_quota_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_tribe_id TEXT NOT NULL,
  policy_id UUID,
  scope TEXT NOT NULL,
  target_service_id TEXT,
  route_family TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL,
  max_requests INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('observe', 'enforce')),
  outcome TEXT NOT NULL CHECK (outcome IN ('allowed', 'observed_exceeded', 'blocked')),
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tribe_quota_decisions_owner_created_idx
  ON api_center_ops.tribe_api_quota_decisions (owner_tribe_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tribe_quota_decisions_outcome_created_idx
  ON api_center_ops.tribe_api_quota_decisions (outcome, created_at DESC);

CREATE INDEX IF NOT EXISTS tribe_quota_decisions_correlation_idx
  ON api_center_ops.tribe_api_quota_decisions (correlation_id);
