import {
  contractTestRequestSchema,
  contractTestResultSchema,
  managementSessionResponseSchema,
  runtimeCapabilitiesResponseSchema,
  smokeTestRequestSchema,
  smokeTestResultSchema,
  registryDetailResponseSchema,
  registryListResponseSchema,
  registrationRequestDetailResponseSchema,
  registrationRequestListResponseSchema,
  readinessResponseSchema,
  tribeTokenRequestSchema,
  tribeTokenResponseSchema,
  tribeSecretDeleteRequestSchema,
  tribeSecretDeleteResponseSchema,
  tribeSecretProvisionRequestSchema,
  tribeSecretProvisionResponseSchema,
  tribeSecretStatusResponseSchema,
  sharedServiceSecretStatusResponseSchema,
  confluentS3SinkIncludeTopicRequestSchema,
  confluentS3SinkIncludeTopicResponseSchema,
  confluentS3SinkRemoveTopicRequestSchema,
  confluentS3SinkRemoveTopicResponseSchema,
  confluentPipelineStatusResponseSchema,
  confluentTopicProvisionRequestSchema,
  confluentTopicProvisionResponseSchema,
  topicMigrationRequestSchema,
  topicMigrationResponseSchema,
  topicOnboardingStateResponseSchema,
  deploymentRestartResponseSchema,
  auditEventsResponseSchema,
  gatewayTrafficResponseSchema,
  operationalAlertsResponseSchema,
  operationPreviewResponseSchema,
  pipelineFeedbackActionRequestSchema,
  pipelineFeedbackActionResponseSchema,
  assignTribePlanInputSchema,
  assignTribePlanResponseSchema,
  quotaPolicyDetailResponseSchema,
  quotaPolicyListResponseSchema,
  quotaIncreaseRequestInputSchema,
  quotaIncreaseRequestResponseSchema,
  apiProductListResponseSchema,
  consumerScorecardResponseSchema,
  governanceDriftResponseSchema,
  platformLifecycleResponseSchema,
  promotionEvidenceResponseSchema,
  runtimeDependencyMapResponseSchema,
  quotaUsageResponseSchema,
  rawToSilverRunRequestSchema,
  rawToSilverRunResponseSchema,
  pipelineAthenaCostResponseSchema,
  pipelineGatewayDecisionResponseSchema,
  pipelineDecisionSignalResponseSchema,
  pipelineHealthResponseSchema,
  pipelineQualityResponseSchema,
  pipelineSharedServiceUsageResponseSchema,
  providerUsageResponseSchema,
  serviceHealthResultSchema,
  serviceManifestSchema,
  sharedServiceRuntimeUsageResponseSchema,
  tribePlanAssignmentsResponseSchema,
  tribePlanDefinitionsResponseSchema,
  type AssignTribePlanInput,
  type AssignTribePlanResult,
  type ContractTestRequest,
  type ContractTestResult,
  type ManagementSession,
  type RuntimeCapabilities,
  type SmokeTestRequest,
  type SmokeTestResult,
  type ReadinessResponse,
  type AuditEvent,
  type GatewayTrafficSummary,
  type OperationalAlert,
  type ProviderUsage,
  type ServiceManifest,
  type ServiceHealthResult,
  type ServiceRegistryEntry,
  type RegistrationRequestStatus,
  type ServiceRegistrationRequest,
  type SharedServiceRuntimeUsage,
  type SharedServiceUsageWindow,
  type TribeTokenRequest,
  type TribeSecretDeleteRequest,
  type TribeSecretProvisionRequest,
  type TribeSecretProvisionResponse,
  type SharedServiceSecretStatusResponse,
  type ConfluentS3SinkIncludeTopicRequest,
  type ConfluentS3SinkIncludeTopicResponse,
  type ConfluentS3SinkRemoveTopicRequest,
  type ConfluentS3SinkRemoveTopicResponse,
  type ConfluentPipelineStatusResponse,
  type ConfluentTopicProvisionRequest,
  type ConfluentTopicProvisionResponse,
  type TopicMigrationRequest,
  type TopicMigrationResponse,
  type TopicOnboardingStateRecord,
  type DeploymentRestartResponse,
  type OperationPreview,
  type PlatformLifecycle,
  type PipelineAthenaCostRow,
  type PipelineFeedbackActionRequest,
  type PipelineFeedbackRecord,
  type PipelineGatewayDecisionRow,
  type PipelineDecisionSignalRow,
  type PipelineHealthEnvironment,
  type PipelineHealthRow,
  type PipelinePartitionDate,
  type PipelineQualityRow,
  type RawToSilverRunRequest,
  type RawToSilverRunResult,
  type PipelineSharedServiceUsageRow,
  type QuotaPolicy,
  type QuotaIncreaseRequestInput,
  type ApiProduct,
  type ConsumerScorecard,
  type DependencyEdge,
  type GovernanceDriftItem,
  type PromotionEvidenceSection,
  type QuotaUsageDecision,
  type QuotaUsageWindow,
  type TribePlanAssignment,
  type TribePlanDefinition,
} from "@/lib/schemas";
import {
  quotaPolicyInputSchema,
  type QuotaPolicyInput,
} from "@/lib/quota-policy";
import { request } from "@/lib/api-center/client-core";

export type { OperationPreview, RuntimeCapabilities } from "@/lib/schemas";
export {
  getApiCenterBaseUrl,
  setManagementSessionToken,
} from "@/lib/api-center/client-core";
export * from "@/lib/api-center/data-pipeline-client";
export * from "@/lib/api-center/operations-client";
export * from "@/lib/api-center/quotas-client";
export * from "@/lib/api-center/registry-client";
export * from "@/lib/api-center/secrets-client";

export async function getReadiness(): Promise<ReadinessResponse> {
  const data = await request<unknown>("/api/local/readiness");
  return readinessResponseSchema.parse(data);
}

export async function getRuntimeCapabilities(): Promise<RuntimeCapabilities> {
  const data = await request<unknown>("/api/local/capabilities");
  return runtimeCapabilitiesResponseSchema.parse(data).data;
}

export async function getManagementSession(): Promise<ManagementSession> {
  const data = await request<unknown>("/api/local/session");
  return managementSessionResponseSchema.parse(data).data;
}

export async function testContract(
  input: ContractTestRequest,
): Promise<ContractTestResult> {
  const payload = contractTestRequestSchema.parse(input);
  const data = await request<unknown>("/api/local/contract/test", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return contractTestResultSchema.parse(data);
}

export async function requestTribeToken(input: TribeTokenRequest) {
  const payload = tribeTokenRequestSchema.parse(input);
  const data = await request<unknown>("/api/local/auth/token", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return tribeTokenResponseSchema.parse(data).data;
}

export async function provisionConfluentTopic(
  input: ConfluentTopicProvisionRequest,
): Promise<ConfluentTopicProvisionResponse["data"]> {
  const payload = confluentTopicProvisionRequestSchema.parse(input);
  const data = await request<unknown>("/api/local/confluent/topics/provision", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return confluentTopicProvisionResponseSchema.parse(data).data;
}

export async function previewConfluentTopicProvision(
  input: ConfluentTopicProvisionRequest,
): Promise<OperationPreview> {
  const payload = confluentTopicProvisionRequestSchema.parse(input);
  const data = await request<{ preview: OperationPreview }>(
    "/api/local/confluent/topics/provision",
    {
      method: "POST",
      body: JSON.stringify({ ...payload, preview: true }),
    },
  );

  return operationPreviewResponseSchema.parse(data).preview;
}

export async function migrateLegacyTopic(
  input: TopicMigrationRequest,
): Promise<TopicMigrationResponse["data"]> {
  const payload = topicMigrationRequestSchema.parse(input);
  const data = await request<unknown>("/api/local/confluent/topic-migrations", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return topicMigrationResponseSchema.parse(data).data;
}

export async function includeConfluentTopicInS3Sink(
  input: ConfluentS3SinkIncludeTopicRequest,
): Promise<ConfluentS3SinkIncludeTopicResponse["data"]> {
  const payload = confluentS3SinkIncludeTopicRequestSchema.parse(input);
  const data = await request<unknown>(
    "/api/local/confluent/s3-sink/include-topic",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  return confluentS3SinkIncludeTopicResponseSchema.parse(data).data;
}

export async function previewConfluentS3SinkIncludeTopic(
  input: ConfluentS3SinkIncludeTopicRequest,
): Promise<OperationPreview> {
  const payload = confluentS3SinkIncludeTopicRequestSchema.parse(input);
  const data = await request<{ preview: OperationPreview }>(
    "/api/local/confluent/s3-sink/include-topic",
    {
      method: "POST",
      body: JSON.stringify({ ...payload, preview: true }),
    },
  );

  return operationPreviewResponseSchema.parse(data).preview;
}

export async function previewConfluentS3SinkRemoveTopic(
  input: ConfluentS3SinkRemoveTopicRequest,
): Promise<OperationPreview> {
  const payload = confluentS3SinkRemoveTopicRequestSchema.parse(input);
  const data = await request<unknown>(
    "/api/local/confluent/s3-sink/remove-topic",
    {
      method: "POST",
      body: JSON.stringify({ ...payload, preview: true }),
    },
  );

  return operationPreviewResponseSchema.parse(data).preview;
}

export async function removeConfluentTopicFromS3Sink(
  input: ConfluentS3SinkRemoveTopicRequest,
): Promise<ConfluentS3SinkRemoveTopicResponse["data"]> {
  const payload = confluentS3SinkRemoveTopicRequestSchema.parse(input);
  const data = await request<unknown>(
    "/api/local/confluent/s3-sink/remove-topic",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  return confluentS3SinkRemoveTopicResponseSchema.parse(data).data;
}

export async function getConfluentPipelineStatus(
  serviceId: string,
  topicName?: string,
  ownerTribeId?: string,
): Promise<ConfluentPipelineStatusResponse["data"]> {
  const params = new URLSearchParams();
  if (topicName) params.set("topicName", topicName);
  if (ownerTribeId) params.set("ownerTribeId", ownerTribeId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const data = await request<unknown>(
    `/api/local/confluent/status/${encodeURIComponent(serviceId)}${suffix}`,
  );

  return confluentPipelineStatusResponseSchema.parse(data).data;
}

export async function getTopicOnboardingState(input: {
  serviceId: string;
  topicName: string;
  ownerTribeId?: string;
}): Promise<TopicOnboardingStateRecord> {
  const params = new URLSearchParams({ serviceId: input.serviceId });
  if (input.ownerTribeId) params.set("ownerTribeId", input.ownerTribeId);
  const data = await request<unknown>(
    `/api/local/topic-onboarding-states/${encodeURIComponent(input.topicName)}?${params.toString()}`,
  );

  return topicOnboardingStateResponseSchema.parse(data).data;
}

export async function restartApiCenterDeployment(input?: {
  confirmation?: { typedPhrase?: string; reason?: string };
}): Promise<DeploymentRestartResponse["data"]> {
  const data = await request<unknown>(
    "/api/local/deployments/api-center/restart",
    { method: "POST", body: JSON.stringify(input ?? {}) },
  );

  return deploymentRestartResponseSchema.parse(data).data;
}

export async function previewApiCenterDeploymentRestart(): Promise<OperationPreview> {
  const data = await request<unknown>(
    "/api/local/deployments/api-center/restart",
    {
      method: "POST",
      body: JSON.stringify({ preview: true }),
    },
  );

  return operationPreviewResponseSchema.parse(data).preview;
}

export type EmergencyControlRequest = {
  targetType: string;
  targetId: string;
  mode: string;
  reason: string;
  confirmation: {
    typedPhrase: string;
    reason: string;
  };
};

export async function applyEmergencyControl(
  input: EmergencyControlRequest,
): Promise<unknown> {
  return request<unknown>("/api/local/operations/emergency", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function runSharedServiceSmokeTest(
  input: SmokeTestRequest,
): Promise<SmokeTestResult> {
  const payload = smokeTestRequestSchema.parse(input);
  const data = await request<unknown>("/api/local/smoke-tests/shared-service", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return smokeTestResultSchema.parse(data);
}

export async function previewSharedServiceSmokeOperation(
  operation = "payment.subscription.rollout",
): Promise<OperationPreview> {
  const data = await request<{ preview: OperationPreview }>(
    "/api/local/smoke-tests/shared-service",
    {
      method: "POST",
      body: JSON.stringify({
        preview: true,
        operation,
      }),
    },
  );

  return operationPreviewResponseSchema.parse(data).preview;
}

export async function getSharedServiceRuntimeUsage(
  window: SharedServiceUsageWindow = "24h",
): Promise<SharedServiceRuntimeUsage[]> {
  const data = await request<unknown>(
    `/api/local/analytics/shared-service-usage?window=${encodeURIComponent(window)}`,
  );

  return sharedServiceRuntimeUsageResponseSchema.parse(data).data;
}
