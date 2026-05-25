CREATE TABLE IF NOT EXISTS api_center_ops.tribe_plan_definitions (
  plan_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  gateway_calls_per_day INTEGER,
  kafka_publishes_per_day INTEGER,
  retention_tier TEXT NOT NULL,
  shared_service_access TEXT NOT NULL,
  support_tier TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_center_ops.tribe_plan_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_tribe_id TEXT NOT NULL,
  plan_key TEXT NOT NULL,
  environment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  effective_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  assigned_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tribe_plan_assignments_owner_env_status_idx
  ON api_center_ops.tribe_plan_assignments (owner_tribe_id, environment, status);

CREATE INDEX IF NOT EXISTS tribe_plan_assignments_plan_env_idx
  ON api_center_ops.tribe_plan_assignments (plan_key, environment);

INSERT INTO api_center_ops.tribe_plan_definitions (
  plan_key,
  display_name,
  gateway_calls_per_day,
  kafka_publishes_per_day,
  retention_tier,
  shared_service_access,
  support_tier
)
VALUES
  ('starter', 'Starter', 1000, 100, 'standard', 'test-only-provider-impacting-smoke', 'standard'),
  ('standard', 'Standard', 25000, 5000, 'standard', 'live-after-approval', 'standard'),
  ('pro', 'Pro', 250000, 50000, 'extended', 'live', 'priority'),
  ('enterprise', 'Enterprise', NULL, NULL, 'custom', 'custom', 'dedicated')
ON CONFLICT (plan_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  gateway_calls_per_day = EXCLUDED.gateway_calls_per_day,
  kafka_publishes_per_day = EXCLUDED.kafka_publishes_per_day,
  retention_tier = EXCLUDED.retention_tier,
  shared_service_access = EXCLUDED.shared_service_access,
  support_tier = EXCLUDED.support_tier,
  updated_at = now();
