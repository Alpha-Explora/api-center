ALTER TABLE api_center_ops.pipeline_feedback_actions
  ADD COLUMN IF NOT EXISTS correlation_id text;

CREATE INDEX IF NOT EXISTS pipeline_feedback_actions_correlation_idx
  ON api_center_ops.pipeline_feedback_actions(correlation_id);
