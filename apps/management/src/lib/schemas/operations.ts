import { z } from "zod";
import {
  serviceRegistryEntrySchema,
  serviceTypeSchema,
} from "@/lib/schemas/registry";
import { quotaModeSchema, quotaScopeSchema } from "@/lib/schemas/quotas";

export const runtimeCapabilitiesSchema = z.object({
  coreGateway: z.object({
    enabled: z.literal(true),
    authProvider: z.string(),
    registrySource: z.string(),
    registryBootstrapEnabled: z.boolean(),
  }),
  dataPipeline: z.object({
    enabled: z.boolean(),
  }),
  kafkaPublishing: z.object({
    enabled: z.boolean(),
  }),
  tribeSecrets: z.object({
    source: z.enum(["env-hash", "gcp-secret-manager"]),
  }),
});

export const runtimeCapabilitiesResponseSchema = z.object({
  success: z.boolean(),
  data: runtimeCapabilitiesSchema,
});

export const managementSessionSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string().optional(),
  role: z.enum(["admin", "operator", "observer"]),
  source: z.enum(["local-dev", "google"]),
  organizationIds: z.array(z.string()),
  platformAdmin: z.boolean(),
});

export const managementSessionResponseSchema = z.object({
  success: z.boolean(),
  data: managementSessionSchema,
});

export const contractTestRequestSchema = z.object({
  serviceId: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  path: z.string().min(1).default("/health"),
  bearerToken: z.string().optional(),
});

export const contractAttemptSchema = z.object({
  mode: z.enum(["direct", "api-center-proxy"]),
  url: z.string(),
  ok: z.boolean(),
  skipped: z.boolean().optional(),
  status: z.number().optional(),
  latencyMs: z.number().optional(),
  responsePreview: z.string().optional(),
  error: z.string().optional(),
});

export const contractTestResultSchema = z.object({
  serviceId: z.string(),
  checkedAt: z.string(),
  routeNamespace: z.enum(["tribes", "shared"]),
  attempts: z.array(contractAttemptSchema),
});

/** A token is issued to one tribe service, proven by that service's own environment secret. */
export const serviceTokenRequestSchema = z.object({
  serviceId: z
    .string()
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  secret: z.string().min(1),
  environment: z.enum(["test", "live"]).default("test"),
});

export const serviceTokenResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    accessToken: z.string(),
    refreshToken: z.string().nullable().optional(),
    expiresIn: z.number().optional(),
    serviceId: z.string().optional(),
    projectId: z.string().optional(),
    tribeId: z.string().optional(),
    environment: z.enum(["test", "live"]).optional(),
    scopes: z.array(z.string()).optional(),
  }),
  meta: z
    .object({
      timestamp: z.string().optional(),
    })
    .optional(),
});

const EXPORT_TOPIC_PATTERN =
  /^(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.)?(?:tribe\.([a-z0-9](?:[a-z0-9._-]*[a-z0-9_])?)\.events|api-center\.shared\.([a-z0-9](?:[a-z0-9._-]*[a-z0-9_])?)\.events)$/;

function extractExportTopicOwner(topicName: string) {
  const match = topicName.match(EXPORT_TOPIC_PATTERN);
  return match?.[1] ?? match?.[2] ?? "";
}

export const confluentTopicNameSchema = z
  .string()
  .regex(
    EXPORT_TOPIC_PATTERN,
    "Use a tribe event topic or a supported shared-service export topic, optionally prefixed by environment",
  )
  .refine((topicName) => !extractExportTopicOwner(topicName).includes(".."), {
    message: "Topic owner cannot contain consecutive dots",
  });

export const confluentTopicProvisionRequestSchema = z.object({
  serviceId: z
    .string()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      "Use lower-case letters, numbers, and hyphens only",
    ),
  ownerTribeId: z
    .string()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      "Use lower-case letters, numbers, and hyphens only",
    )
    .optional(),
  topicName: confluentTopicNameSchema.optional(),
  partitions: z.number().int().min(1).max(12).default(1),
  retentionMs: z.number().int().positive().optional(),
  confirmation: z
    .object({
      typedPhrase: z.string().optional(),
      reason: z.string().optional(),
    })
    .optional(),
});

export const confluentTopicProvisionResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    serviceId: z.string(),
    ownerTribeId: z.string().optional(),
    topicName: z.string(),
    clusterId: z.string(),
    created: z.boolean(),
    existed: z.boolean(),
    partitions: z.number(),
    retentionMs: z.number(),
  }),
});

export const topicMigrationRequestSchema = z.object({
  serviceId: z.string().regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  ownerTribeId: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    .optional(),
  serviceType: serviceTypeSchema.default("tribe"),
  confirmation: z
    .object({
      typedPhrase: z.string().optional(),
      reason: z.string().optional(),
    })
    .optional(),
});

export const topicMigrationResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    serviceId: z.string(),
    ownerTribeId: z.string(),
    legacyTopic: z.string(),
    targetTopic: z.string(),
    migrationNeeded: z.boolean(),
    topicProvisioned: z.boolean(),
    sinkIncluded: z.boolean(),
    oldTopicPreserved: z.literal(true),
  }),
});

export const confluentS3SinkIncludeTopicRequestSchema = z.object({
  topicName: confluentTopicNameSchema,
  confirmation: z
    .object({
      typedPhrase: z.string().optional(),
      reason: z.string().optional(),
    })
    .optional(),
});

export const confluentS3SinkIncludeTopicResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    topicName: z.string(),
    connectorName: z.string(),
    updated: z.boolean(),
    alreadyIncluded: z.boolean(),
    topics: z.array(z.string()),
  }),
});

export const confluentS3SinkRemoveTopicRequestSchema = z.object({
  topicName: confluentTopicNameSchema,
  confirmation: z
    .object({
      typedPhrase: z.string().optional(),
      reason: z.string().optional(),
    })
    .optional(),
});

export const confluentS3SinkRemoveTopicResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    topicName: z.string(),
    connectorName: z.string(),
    removed: z.boolean(),
    wasIncluded: z.boolean(),
    topics: z.array(z.string()),
  }),
});

export const confluentPipelineStatusResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    serviceId: z.string(),
    ownerTribeId: z.string().optional(),
    topicName: z.string(),
    topicCheckOk: z.boolean(),
    topicExists: z.boolean(),
    topicCheckError: z.string().optional(),
    s3SinkCheckOk: z.boolean(),
    s3SinkIncludesTopic: z.boolean(),
    s3SinkCheckError: z.string().optional(),
    connectorName: z.string(),
    topics: z.array(z.string()),
  }),
});

export const topicOnboardingStateNameSchema = z.enum([
  "Not configured",
  "Data classification ready",
  "Policy ready",
  "Topic provisioned",
  "Sink included",
  "Publishing",
  "Publishing but not flushed",
  "Raw observed",
  "Bronze cataloged",
  "Curated active",
  "Needs remediation",
  "Rejected",
  "Blocked by exception",
]);

export const topicOnboardingTransitionSchema = z.object({
  previous_state: topicOnboardingStateNameSchema,
  new_state: topicOnboardingStateNameSchema,
  actor: z.string(),
  approver: z.string().optional(),
  timestamp: z.string(),
  evidence_link: z.string().optional(),
  blocking_reason: z.string().optional(),
  next_review_date: z.string().optional(),
});

export const topicOnboardingStateRecordSchema = z.object({
  service_id: z.string(),
  canonical_service_id: z.string(),
  owner_tribe_id: z.string(),
  canonical_tribe_id: z.string(),
  source_service_ids: z.array(z.string()),
  environment: z.string(),
  source_system: z.string(),
  logical_topic: z.string(),
  physical_topic: z.string(),
  connector_name: z.string().optional(),
  s3_prefix: z.string(),
  glue_database: z.string().optional(),
  glue_table: z.string().optional(),
  bronze_table: z.string().optional(),
  current_state: topicOnboardingStateNameSchema,
  classification_tier: z.string().optional(),
  retention_tier: z.string().optional(),
  data_owner: z.string().optional(),
  data_steward: z.string().optional(),
  approved_reader_groups: z.array(z.string()),
  publish_quota: z.string().optional(),
  event_size_limit: z.string().optional(),
  latest_accepted_publish_at: z.string().optional(),
  latest_kafka_observed_at: z.string().optional(),
  latest_s3_object_at: z.string().optional(),
  latest_bronze_observed_at: z.string().optional(),
  latest_bronze_count: z.number().optional(),
  curated_signoff_at: z.string().optional(),
  exception_status: z
    .enum(["none", "rejected", "blocked_by_exception"])
    .default("none"),
  failure_reason: z.string().optional(),
  last_access_review_at: z.string().optional(),
  next_review_date: z.string().optional(),
  transition_history: z.array(topicOnboardingTransitionSchema),
});

export const topicOnboardingStateResponseSchema = z.object({
  success: z.boolean(),
  data: topicOnboardingStateRecordSchema,
});

export const deploymentRestartResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    namespace: z.string(),
    deployment: z.string(),
    restartedAt: z.string(),
    revision: z.string().optional(),
    restartOutput: z.string(),
    statusOutput: z.string(),
  }),
});

export const operationPreviewSchema = z.object({
  actionId: z.string(),
  environment: z.enum(["test", "live"]),
  risk: z.enum([
    "read",
    "low-write",
    "state-write",
    "provider-write",
    "destructive",
  ]),
  changes: z.array(z.string()),
  confirmationPhrase: z.string().optional(),
  reasonRequired: z.boolean(),
});

export const operationPreviewResponseSchema = z.object({
  preview: operationPreviewSchema,
});

export const smokeTestRequestSchema = z.object({
  serviceId: z.enum(["gauth", "geo", "payment", "email", "sms", "otp"]),
  method: z.enum(["GET", "POST"]),
  path: z.string().min(1),
  bearerToken: z.string().min(1),
  body: z.unknown().optional(),
  confirmation: z
    .object({
      typedPhrase: z.string().optional(),
      reason: z.string().optional(),
    })
    .optional(),
});

export const smokeTestResultSchema = z.object({
  serviceId: z.string(),
  path: z.string(),
  method: z.string(),
  url: z.string(),
  ok: z.boolean(),
  status: z.number().optional(),
  latencyMs: z.number(),
  responsePreview: z.string().optional(),
  checkedAt: z.string(),
});

export const sharedServiceUsageWindowSchema = z.enum([
  "1h",
  "24h",
  "7d",
  "30d",
]);

export const managementSourceMetadataSchema = z.object({
  sourceType: z.enum([
    "durable",
    "volatile",
    "external",
    "computed",
    "unavailable",
  ]),
  sourceName: z.string(),
  durability: z.enum([
    "postgres",
    "redis-window",
    "provider-api",
    "athena",
    "computed-projection",
    "none",
  ]),
  window: sharedServiceUsageWindowSchema.optional(),
  lastRefreshedAt: z.string().optional(),
  staleAfterSeconds: z.number().optional(),
  degradedReason: z.string().optional(),
  evidenceTable: z.string().optional(),
  correlationId: z.string().optional(),
});

const sourceAwareMetaSchema = z
  .object({
    window: sharedServiceUsageWindowSchema.optional(),
    total: z.number().optional(),
    timestamp: z.string().optional(),
    correlationId: z.string().optional(),
    sourceMetadata: z.array(managementSourceMetadataSchema).optional(),
  })
  .optional();

export const governanceDriftItemSchema = z.object({
  severity: z.enum(["warning", "critical"]),
  resourceType: z.string(),
  resourceId: z.string(),
  ownerTribeId: z.string(),
  message: z.string(),
});

export const governanceDriftResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    status: z.string(),
    items: z.array(governanceDriftItemSchema),
  }),
});

export const dependencyEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.string(),
});

export const runtimeDependencyMapResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        label: z.string(),
      }),
    ),
    edges: z.array(dependencyEdgeSchema),
  }),
});

export const promotionEvidenceSectionSchema = z.object({
  key: z.string(),
  status: z.enum(["pass", "fail"]),
  data: z.unknown().optional(),
});

export const promotionEvidenceResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    serviceId: z.string(),
    ready: z.boolean(),
    generatedAt: z.string(),
    sections: z.array(promotionEvidenceSectionSchema),
  }),
});

export const serviceLifecycleStageStatusSchema = z.enum([
  "complete",
  "attention",
  "blocked",
  "not-required",
]);

export const serviceLifecycleStatusSchema = z.enum([
  "blocked",
  "attention",
  "ready",
]);

export const serviceLifecycleStageIdSchema = z.enum([
  "registry",
  "ownership",
  "dependencies",
  "runtime",
  "quotas",
  "pipeline",
  "promotion",
  "evidence",
]);

export const serviceLifecycleStageSchema = z.object({
  id: serviceLifecycleStageIdSchema,
  label: z.string(),
  status: serviceLifecycleStageStatusSchema,
  evidence: z.string(),
  source: z.string(),
  action: z.string(),
  href: z.string(),
});

export const serviceLifecycleEntrySchema = z.object({
  service: serviceRegistryEntrySchema,
  ownerTribeId: z.string(),
  status: serviceLifecycleStatusSchema,
  stages: z.array(serviceLifecycleStageSchema),
  blockedCount: z.number(),
  attentionCount: z.number(),
  nextAction: z.object({
    stageId: serviceLifecycleStageIdSchema,
    label: z.string(),
    href: z.string(),
  }),
});

export const platformLifecycleSchema = z.object({
  generatedAt: z.string(),
  summary: z.object({
    total: z.number(),
    blocked: z.number(),
    attention: z.number(),
    ready: z.number(),
  }),
  entries: z.array(serviceLifecycleEntrySchema),
});

export const platformLifecycleResponseSchema = z.object({
  success: z.boolean(),
  data: platformLifecycleSchema,
});

export const apiProductSchema = z.object({
  productId: z.string(),
  displayName: z.string(),
  category: z.string(),
  ownerTeam: z.string(),
  contact: z.string(),
  serviceTier: z.string(),
  requiredScopes: z.array(z.string()),
  exposes: z.array(z.string()),
  onboardingStatus: z.string(),
});

export const apiProductListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(apiProductSchema),
});

export const consumerScorecardSchema = z.object({
  ownerTribeId: z.string(),
  status: z.string(),
  sdkVersion: z.string().optional(),
  latestSdkVersion: z.string().optional(),
  quotaUsagePercent: z.union([z.number(), z.literal("unknown")]).optional(),
  errorRatePercent: z.union([z.number(), z.literal("unknown")]).optional(),
  findings: z.array(z.string()),
});

export const consumerScorecardResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(consumerScorecardSchema),
});

export const tribePlanKeySchema = z.enum([
  "starter",
  "standard",
  "pro",
  "enterprise",
]);
export const tribePlanEnvironmentSchema = z.enum(["test", "live"]);
export const tribePlanAssignmentStatusSchema = z.enum(["active", "disabled"]);

export const tribePlanDefinitionSchema = z.object({
  planKey: tribePlanKeySchema,
  displayName: z.string(),
  gatewayCallsPerDay: z.number().int().positive().nullable(),
  kafkaPublishesPerDay: z.number().int().positive().nullable(),
  retentionTier: z.string(),
  sharedServiceAccess: z.string(),
  supportTier: z.string(),
});

export const tribePlanAssignmentSchema = z.object({
  id: z.string().optional(),
  ownerTribeId: z.string(),
  projectId: z.string(),
  planKey: tribePlanKeySchema,
  environment: tribePlanEnvironmentSchema,
  status: tribePlanAssignmentStatusSchema,
  effectiveAt: z.string(),
  reason: z.string(),
  assignedBy: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const generatedQuotaPolicyProposalSchema = z.object({
  ownerTribeId: z.string(),
  projectId: z.string(),
  scope: quotaScopeSchema,
  targetServiceId: z.string().nullable().optional(),
  windowSeconds: z.number().int().positive(),
  maxRequests: z.number().int().positive(),
  mode: quotaModeSchema,
  reason: z.string(),
});

/** Plans are assigned to a project; the gateway derives its tribe. */
export const assignTribePlanInputSchema = z.object({
  projectId: z.string().min(1),
  planKey: tribePlanKeySchema,
  environment: tribePlanEnvironmentSchema,
  effectiveAt: z.string().optional(),
  reason: z.string().min(1),
});

export const tribePlanDefinitionsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(tribePlanDefinitionSchema),
  meta: z
    .object({
      timestamp: z.string().optional(),
      correlationId: z.string().optional(),
    })
    .optional(),
});

export const tribePlanAssignmentsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(tribePlanAssignmentSchema),
  meta: z
    .object({
      timestamp: z.string().optional(),
      correlationId: z.string().optional(),
    })
    .optional(),
});

export const assignTribePlanResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    assignment: tribePlanAssignmentSchema,
    quotaProposals: z.array(generatedQuotaPolicyProposalSchema),
  }),
  meta: z
    .object({
      timestamp: z.string().optional(),
      correlationId: z.string().optional(),
    })
    .optional(),
});

export const sharedServiceRuntimeUsageSchema = z.object({
  tribeServiceId: z.string(),
  sharedServiceId: z.string(),
  window: sharedServiceUsageWindowSchema,
  totalRequests: z.number(),
  successRequests: z.number(),
  failedRequests: z.number(),
  errorRate: z.number(),
  avgLatencyMs: z.number(),
  p95LatencyMs: z.number().optional(),
  lastUsedAt: z.string().optional(),
});

export const sharedServiceRuntimeUsageResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(sharedServiceRuntimeUsageSchema),
  meta: sourceAwareMetaSchema,
});

export const gatewayTrafficSummarySchema = z.object({
  window: sharedServiceUsageWindowSchema,
  totalProxyRequests: z.number(),
  tribeToTribeRequests: z.number(),
  tribeToSharedRequests: z.number(),
  status4xx: z.number(),
  status5xx: z.number(),
  kafkaPublishFailures: z.number(),
  readinessFailures: z.number(),
  avgLatencyMs: z.number(),
  p95LatencyMs: z.number(),
  lastSeenAt: z.string().optional(),
});

export const gatewayTrafficResponseSchema = z.object({
  success: z.boolean(),
  data: gatewayTrafficSummarySchema,
  meta: sourceAwareMetaSchema,
});

export const auditEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  actionFamily: z.string().optional(),
  actor: z.string().optional(),
  serviceId: z.string().optional(),
  tribeServiceId: z.string().optional(),
  sharedServiceId: z.string().optional(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string(),
});

export const auditEventsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(auditEventSchema),
  meta: sourceAwareMetaSchema,
});

export const providerUsageSchema = z.object({
  sharedServiceId: z.string(),
  provider: z.string(),
  totalRequests: z.number(),
  failedRequests: z.number(),
  avgLatencyMs: z.number(),
  tribeCount: z.number(),
  errorRate: z.number(),
  tribes: z.array(z.string()),
  lastUsedAt: z.string().optional(),
});

export const providerUsageResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(providerUsageSchema),
  meta: sourceAwareMetaSchema,
});

export const operationalAlertSchema = z.object({
  id: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  type: z.string(),
  serviceId: z.string().optional(),
  message: z.string(),
  firstSeenAt: z.string().optional(),
  lastSeenAt: z.string().optional(),
  recommendation: z.string(),
});

export const operationalAlertsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(operationalAlertSchema),
  meta: sourceAwareMetaSchema,
});

export type PlatformLifecycle = z.infer<typeof platformLifecycleSchema>;
export type RuntimeCapabilities = z.infer<typeof runtimeCapabilitiesSchema>;
export type RuntimeCapabilitiesResponse = z.infer<
  typeof runtimeCapabilitiesResponseSchema
>;
export type ManagementSessionResponse = z.infer<
  typeof managementSessionResponseSchema
>;
export type ManagementSession = z.infer<typeof managementSessionSchema>;
export type ContractTestRequest = z.infer<typeof contractTestRequestSchema>;
export type ContractTestResult = z.infer<typeof contractTestResultSchema>;
export type ServiceTokenRequest = z.input<typeof serviceTokenRequestSchema>;
export type ServiceTokenResponse = z.infer<typeof serviceTokenResponseSchema>;
export type ConfluentTopicProvisionRequest = z.infer<
  typeof confluentTopicProvisionRequestSchema
>;
export type ConfluentTopicProvisionResponse = z.infer<
  typeof confluentTopicProvisionResponseSchema
>;
export type TopicMigrationRequest = z.infer<typeof topicMigrationRequestSchema>;
export type TopicMigrationResponse = z.infer<
  typeof topicMigrationResponseSchema
>;
export type ConfluentS3SinkIncludeTopicRequest = z.infer<
  typeof confluentS3SinkIncludeTopicRequestSchema
>;
export type ConfluentS3SinkIncludeTopicResponse = z.infer<
  typeof confluentS3SinkIncludeTopicResponseSchema
>;
export type ConfluentS3SinkRemoveTopicRequest = z.infer<
  typeof confluentS3SinkRemoveTopicRequestSchema
>;
export type ConfluentS3SinkRemoveTopicResponse = z.infer<
  typeof confluentS3SinkRemoveTopicResponseSchema
>;
export type ConfluentPipelineStatusResponse = z.infer<
  typeof confluentPipelineStatusResponseSchema
>;
export type TopicOnboardingStateRecord = z.infer<
  typeof topicOnboardingStateRecordSchema
>;
export type TopicOnboardingStateResponse = z.infer<
  typeof topicOnboardingStateResponseSchema
>;
export type DeploymentRestartResponse = z.infer<
  typeof deploymentRestartResponseSchema
>;
export type OperationPreview = z.infer<typeof operationPreviewSchema>;
export type SmokeTestRequest = z.infer<typeof smokeTestRequestSchema>;
export type SmokeTestResult = z.infer<typeof smokeTestResultSchema>;
export type SharedServiceUsageWindow = z.infer<
  typeof sharedServiceUsageWindowSchema
>;
export type GovernanceDriftItem = z.infer<typeof governanceDriftItemSchema>;
export type DependencyEdge = z.infer<typeof dependencyEdgeSchema>;
export type PromotionEvidenceSection = z.infer<
  typeof promotionEvidenceSectionSchema
>;
export type ApiProduct = z.infer<typeof apiProductSchema>;
export type ConsumerScorecard = z.infer<typeof consumerScorecardSchema>;
export type TribePlanKey = z.infer<typeof tribePlanKeySchema>;
export type TribePlanEnvironment = z.infer<typeof tribePlanEnvironmentSchema>;
export type TribePlanAssignmentStatus = z.infer<
  typeof tribePlanAssignmentStatusSchema
>;
export type TribePlanDefinition = z.infer<typeof tribePlanDefinitionSchema>;
export type TribePlanAssignment = z.infer<typeof tribePlanAssignmentSchema>;
export type GeneratedQuotaPolicyProposal = z.infer<
  typeof generatedQuotaPolicyProposalSchema
>;
export type AssignTribePlanInput = z.infer<typeof assignTribePlanInputSchema>;
export type AssignTribePlanResult = z.infer<
  typeof assignTribePlanResponseSchema
>["data"];
export type SharedServiceRuntimeUsage = z.infer<
  typeof sharedServiceRuntimeUsageSchema
>;
export type GatewayTrafficSummary = z.infer<typeof gatewayTrafficSummarySchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type ProviderUsage = z.infer<typeof providerUsageSchema>;
export type OperationalAlert = z.infer<typeof operationalAlertSchema>;
