import { z } from "zod";
import { managementSourceMetadataSchema } from "@/lib/schemas/operations";

export const pipelineHealthEnvironmentSchema = z.enum(["test", "prod"]);
export const pipelinePartitionDateSchema = z.object({
  year: z.string().regex(/^\d{4}$/),
  month: z.string().regex(/^\d{2}$/),
  day: z.string().regex(/^\d{2}$/),
});

export const rawToSilverRunRequestSchema = z.object({
  environment: pipelineHealthEnvironmentSchema,
  tribeId: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/,
      "Use lowercase letters, numbers, dots, underscores, or hyphens",
    ),
  year: z.string().regex(/^\d{4}$/),
  month: z.string().regex(/^\d{2}$/),
  day: z.string().regex(/^\d{2}$/),
  materialize: z.boolean().default(false),
  preview: z.boolean().default(false),
});

const rawToSilverRunStageSchema = z.object({
  rowCount: z.number().optional(),
  queryExecutionId: z.string().optional(),
  outputLocation: z.string().optional(),
  bytesScanned: z.number().optional(),
  completedAt: z.string().optional(),
});

export const rawToSilverRunResultSchema = z.object({
  status: z.enum(["preview", "completed", "blocked"]),
  blockedReason: z.string().optional(),
  environment: pipelineHealthEnvironmentSchema,
  tribeId: z.string(),
  physicalTopic: z.string(),
  partition: pipelinePartitionDateSchema,
  startedAt: z.string(),
  completedAt: z.string().optional(),
  raw: rawToSilverRunStageSchema,
  bronze: rawToSilverRunStageSchema,
  commonSilver: rawToSilverRunStageSchema,
  materialization: z
    .object({
      requested: z.boolean(),
      targetDatabase: z.string(),
      targetTable: z.string(),
      externalLocation: z.string(),
      queryExecutionId: z.string().optional(),
      outputLocation: z.string().optional(),
      completedAt: z.string().optional(),
    })
    .optional(),
  previewQueries: z.object({
    raw: z.string(),
    bronze: z.string(),
    commonSilver: z.string(),
    createMaterializedDatabase: z.string().optional(),
    materialize: z.string().optional(),
  }),
});

export const rawToSilverRunResponseSchema = z.object({
  success: z.boolean(),
  data: rawToSilverRunResultSchema,
  meta: z
    .object({
      environment: pipelineHealthEnvironmentSchema.optional(),
      partition: pipelinePartitionDateSchema.optional(),
      timestamp: z.string().optional(),
      correlationId: z.string().optional(),
    })
    .optional(),
});

export const pipelineHealthRowSchema = z.object({
  environment: pipelineHealthEnvironmentSchema,
  tribeId: z.string(),
  sourceServiceId: z.string().optional(),
  eventType: z.string(),
  eventDay: z.string(),
  eventCount: z.number(),
  latestOccurredAt: z.string().optional(),
  latestIngestedAt: z.string().optional(),
  connectorName: z.string().optional(),
  connectorState: z.string().optional(),
  s3Prefix: z.string().optional(),
  latestS3ObjectKey: z.string().optional(),
  latestS3ObjectAt: z.string().optional(),
  latestBronzeObservedAt: z.string().optional(),
  latestCommonSilverObservedAt: z.string().optional(),
  latestGoldObservedAt: z.string().optional(),
  qualityErrorCount: z.number().optional(),
  athenaResultLocation: z.string().optional(),
  bytesScanned: z.number().optional(),
  lastRefreshedAt: z.string().optional(),
});

export const pipelineHealthResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(pipelineHealthRowSchema),
  meta: z.object({
    environment: pipelineHealthEnvironmentSchema,
    pipelineLane: pipelineHealthEnvironmentSchema.optional(),
    partition: pipelinePartitionDateSchema.optional(),
    source: z.enum(["evidence-file", "athena-proxy"]),
    timestamp: z.string(),
    correlationId: z.string().optional(),
    sourceMetadata: z.array(managementSourceMetadataSchema).optional(),
  }),
});

const pipelineGovernanceMetaSchema = z.object({
  environment: pipelineHealthEnvironmentSchema,
  pipelineLane: pipelineHealthEnvironmentSchema.optional(),
  partition: pipelinePartitionDateSchema.optional(),
  windowDays: z.number().int().positive().optional(),
  source: z.enum(["evidence-file", "athena-proxy"]),
  timestamp: z.string(),
  correlationId: z.string().optional(),
  sourceMetadata: z.array(managementSourceMetadataSchema).optional(),
});

export const pipelineQualityRowSchema = z.object({
  environment: pipelineHealthEnvironmentSchema,
  tribeId: z.string(),
  sourceServiceId: z.string().optional(),
  eventType: z.string(),
  eventDay: z.string(),
  eventCount: z.number(),
  validEventCount: z.number(),
  invalidEventCount: z.number(),
  qualityErrorCount: z.number(),
  latestQualityError: z.string().optional(),
  latestObservedAt: z.string().optional(),
});

export const pipelineSharedServiceUsageRowSchema = z.object({
  environment: pipelineHealthEnvironmentSchema,
  tribeId: z.string(),
  sharedServiceId: z.string(),
  provider: z.string(),
  providerStatus: z.string(),
  eventDay: z.string(),
  eventCount: z.number(),
  successCount: z.number(),
  failureCount: z.number(),
  latestOccurredAt: z.string().optional(),
  latestIngestedAt: z.string().optional(),
});

export const pipelineGatewayDecisionRowSchema = z.object({
  environment: pipelineHealthEnvironmentSchema,
  tribeId: z.string(),
  sourceServiceId: z.string().optional(),
  targetServiceId: z.string().optional(),
  scope: z.string().optional(),
  decision: z.enum(["allowed", "denied", "unknown"]),
  eventDay: z.string(),
  decisionCount: z.number(),
  allowedCount: z.number(),
  deniedCount: z.number(),
  avgLatencyMs: z.number().optional(),
  latestOccurredAt: z.string().optional(),
  latestIngestedAt: z.string().optional(),
});

export const pipelineAthenaCostRowSchema = z.object({
  environment: pipelineHealthEnvironmentSchema,
  workgroup: z.string(),
  resultPurpose: z.string(),
  eventDay: z.string(),
  queryCount: z.number(),
  bytesScanned: z.number(),
  estimatedCostUsd: z.number(),
  maxBytesScanned: z.number().optional(),
  latestQueryExecutionId: z.string().optional(),
  latestCompletedAt: z.string().optional(),
});

export const pipelineDecisionSignalRowSchema = z.object({
  signalId: z.string(),
  environment: pipelineHealthEnvironmentSchema,
  tribeId: z.string(),
  sourceServiceId: z.string().optional(),
  signalType: z.enum([
    "pipeline_stale",
    "bronze_quality_regression",
    "athena_cost_spike",
    "gateway_denial_spike",
    "shared_service_error_spike",
  ]),
  severity: z.enum(["low", "medium", "high"]),
  metricName: z.string(),
  observedValue: z.number(),
  expectedValue: z.number(),
  recommendation: z.string(),
  evidenceQueryId: z.string().optional(),
  evidenceWindowStart: z.string(),
  evidenceWindowEnd: z.string(),
  createdAt: z.string(),
  status: z.enum([
    "open",
    "acknowledged",
    "false_positive",
    "action_requested",
    "blocked",
  ]),
});

export const pipelineQualityResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(pipelineQualityRowSchema),
  meta: pipelineGovernanceMetaSchema,
});

export const pipelineSharedServiceUsageResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(pipelineSharedServiceUsageRowSchema),
  meta: pipelineGovernanceMetaSchema,
});

export const pipelineGatewayDecisionResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(pipelineGatewayDecisionRowSchema),
  meta: pipelineGovernanceMetaSchema,
});

export const pipelineAthenaCostResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(pipelineAthenaCostRowSchema),
  meta: pipelineGovernanceMetaSchema,
});

export const pipelineDecisionSignalResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(pipelineDecisionSignalRowSchema),
  meta: pipelineGovernanceMetaSchema,
});

export const pipelineFeedbackActionSchema = z.enum([
  "validation.rerun.requested",
  "evidence.reviewed",
  "decision.false_positive.marked",
  "onboarding.state.opened",
  "promotion.blocked",
  "schema.fix.requested",
]);

export const pipelineFeedbackTargetTypeSchema = z.enum([
  "topic",
  "tribe",
  "service",
  "event",
  "signal",
  "query",
]);

export const pipelineFeedbackActionRequestSchema = z.object({
  action: pipelineFeedbackActionSchema,
  environment: pipelineHealthEnvironmentSchema,
  targetType: pipelineFeedbackTargetTypeSchema,
  targetId: z.string().min(1),
  ownerTribeId: z.string().optional(),
  evidenceLink: z.string().optional(),
  reason: z.string().trim().min(1),
});

export const pipelineFeedbackRecordSchema =
  pipelineFeedbackActionRequestSchema.extend({
    id: z.string(),
    actorId: z.string(),
    actorRole: z.string(),
    createdAt: z.string(),
    status: z.enum(["pending", "reviewed", "blocking", "closed"]),
  });

export const pipelineFeedbackActionResponseSchema = z.object({
  success: z.boolean(),
  data: pipelineFeedbackRecordSchema,
});

export const pipelineFeedbackActionListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(pipelineFeedbackRecordSchema),
});

export type PipelineHealthEnvironment = z.infer<
  typeof pipelineHealthEnvironmentSchema
>;
export type PipelinePartitionDate = z.infer<typeof pipelinePartitionDateSchema>;
export type RawToSilverRunRequest = z.infer<typeof rawToSilverRunRequestSchema>;
export type RawToSilverRunResult = z.infer<typeof rawToSilverRunResultSchema>;
export type RawToSilverRunResponse = z.infer<
  typeof rawToSilverRunResponseSchema
>;
export type PipelineHealthRow = z.infer<typeof pipelineHealthRowSchema>;
export type PipelineHealthResponse = z.infer<
  typeof pipelineHealthResponseSchema
>;
export type PipelineQualityRow = z.infer<typeof pipelineQualityRowSchema>;
export type PipelineSharedServiceUsageRow = z.infer<
  typeof pipelineSharedServiceUsageRowSchema
>;
export type PipelineGatewayDecisionRow = z.infer<
  typeof pipelineGatewayDecisionRowSchema
>;
export type PipelineAthenaCostRow = z.infer<typeof pipelineAthenaCostRowSchema>;
export type PipelineDecisionSignalRow = z.infer<
  typeof pipelineDecisionSignalRowSchema
>;
export type PipelineFeedbackAction = z.infer<
  typeof pipelineFeedbackActionSchema
>;
export type PipelineFeedbackActionRequest = z.infer<
  typeof pipelineFeedbackActionRequestSchema
>;
export type PipelineFeedbackRecord = z.infer<
  typeof pipelineFeedbackRecordSchema
>;
