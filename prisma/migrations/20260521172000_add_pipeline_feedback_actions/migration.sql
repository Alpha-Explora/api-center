CREATE TABLE IF NOT EXISTS api_center_ops.pipeline_feedback_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (
    action IN (
      'validation.rerun.requested',
      'evidence.reviewed',
      'decision.false_positive.marked',
      'onboarding.state.opened',
      'promotion.blocked',
      'schema.fix.requested'
    )
  ),
  environment text NOT NULL CHECK (environment IN ('test', 'prod')),
  target_type text NOT NULL CHECK (
    target_type IN ('topic', 'tribe', 'service', 'event', 'signal', 'query')
  ),
  target_id text NOT NULL,
  owner_tribe_id text,
  evidence_link text,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'reviewed', 'blocking', 'closed')
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_feedback_actions_env_target_idx
  ON api_center_ops.pipeline_feedback_actions(environment, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pipeline_feedback_actions_status_created_idx
  ON api_center_ops.pipeline_feedback_actions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS pipeline_feedback_actions_owner_idx
  ON api_center_ops.pipeline_feedback_actions(owner_tribe_id, created_at DESC);
