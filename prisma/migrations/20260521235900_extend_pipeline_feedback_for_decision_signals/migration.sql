ALTER TABLE api_center_ops.pipeline_feedback_actions
  DROP CONSTRAINT IF EXISTS pipeline_feedback_actions_action_check;

ALTER TABLE api_center_ops.pipeline_feedback_actions
  ADD CONSTRAINT pipeline_feedback_actions_action_check CHECK (
    action IN (
      'validation.rerun.requested',
      'evidence.reviewed',
      'decision.false_positive.marked',
      'onboarding.state.opened',
      'promotion.blocked',
      'schema.fix.requested'
    )
  );

ALTER TABLE api_center_ops.pipeline_feedback_actions
  DROP CONSTRAINT IF EXISTS pipeline_feedback_actions_target_type_check;

ALTER TABLE api_center_ops.pipeline_feedback_actions
  ADD CONSTRAINT pipeline_feedback_actions_target_type_check CHECK (
    target_type IN ('topic', 'tribe', 'service', 'event', 'signal', 'query')
  );
