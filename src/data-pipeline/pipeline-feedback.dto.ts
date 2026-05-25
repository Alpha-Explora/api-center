import { IsIn, IsOptional, IsString, Matches } from "class-validator";

export const PIPELINE_FEEDBACK_ACTIONS = [
  "validation.rerun.requested",
  "evidence.reviewed",
  "decision.false_positive.marked",
  "onboarding.state.opened",
  "promotion.blocked",
  "schema.fix.requested",
] as const;

export type PipelineFeedbackAction = (typeof PIPELINE_FEEDBACK_ACTIONS)[number];

export const PIPELINE_FEEDBACK_TARGET_TYPES = [
  "topic",
  "tribe",
  "service",
  "event",
  "signal",
  "query",
] as const;

export type PipelineFeedbackTargetType =
  (typeof PIPELINE_FEEDBACK_TARGET_TYPES)[number];

export class PipelineFeedbackActionDto {
  @IsIn(PIPELINE_FEEDBACK_ACTIONS)
  action!: PipelineFeedbackAction;

  @IsIn(["test", "prod"])
  environment!: "test" | "prod";

  @IsIn(PIPELINE_FEEDBACK_TARGET_TYPES)
  targetType!: PipelineFeedbackTargetType;

  @IsString()
  @Matches(/^[a-zA-Z0-9._:/-]+$/)
  targetId!: string;

  @IsOptional()
  @IsString()
  ownerTribeId?: string;

  @IsOptional()
  @IsString()
  evidenceLink?: string;

  @IsString()
  reason!: string;
}
