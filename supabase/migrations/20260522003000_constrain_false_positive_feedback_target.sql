ALTER TABLE api_center_ops.pipeline_feedback_actions
  DROP CONSTRAINT IF EXISTS pipeline_feedback_actions_false_positive_signal_check;

ALTER TABLE api_center_ops.pipeline_feedback_actions
  ADD CONSTRAINT pipeline_feedback_actions_false_positive_signal_check CHECK (
    action <> 'decision.false_positive.marked'
    OR target_type = 'signal'
  );
