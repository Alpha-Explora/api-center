CREATE TABLE IF NOT EXISTS api_center_ops.topic_onboarding_states (
  physical_topic TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  owner_tribe_id TEXT,
  record JSONB NOT NULL,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS topic_onboarding_states_env_owner_idx
  ON api_center_ops.topic_onboarding_states(environment, owner_tribe_id);

CREATE INDEX IF NOT EXISTS topic_onboarding_states_updated_idx
  ON api_center_ops.topic_onboarding_states(updated_at);
