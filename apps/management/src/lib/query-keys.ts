export const queryKeys = {
  services: ["services"] as const,
  tenancyTribes: ["tenancy", "tribes"] as const,
  service: (serviceId: string) => ["services", serviceId] as const,
  registrationRequests: (status: string) =>
    ["registration-requests", status] as const,
  tribes: ["services", "tribe"] as const,
  tribe: (serviceId: string) => ["services", "tribe", serviceId] as const,
  sharedServices: ["shared-services"] as const,
  sharedServiceUsage: (window: string) =>
    ["shared-services", "usage", window] as const,
  quotaPolicies: (ownerTribeId = "all") =>
    ["quotas", "policies", ownerTribeId] as const,
  /** Project budget plus tribe-wide ceilings that apply to one project. */
  applicableQuotaPolicies: (ownerTribeId: string, projectId = "none") =>
    ["quotas", "policies", ownerTribeId, "applicable", projectId] as const,
  quotaUsage: (ownerTribeId = "all", window = "24h") =>
    ["quotas", "usage", ownerTribeId, window] as const,
  governanceDrift: ["operations", "drift"] as const,
  runtimeDependencies: ["operations", "dependencies"] as const,
  platformLifecycle: ["operations", "lifecycle"] as const,
  promotionEvidence: (serviceId: string) =>
    ["operations", "evidence", serviceId] as const,
  marketplaceProducts: ["catalog", "products"] as const,
  consumerScorecards: ["operations", "scorecards"] as const,
  planDefinitions: ["plans", "definitions"] as const,
  planAssignments: (filter = "all") =>
    ["plans", "assignments", filter] as const,
  gatewayTraffic: (window: string) => ["gateway-traffic", window] as const,
  auditEvents: (filter: string) => ["audit-events", filter] as const,
  providerUsage: (window: string) => ["provider-usage", window] as const,
  operationalAlerts: (window: string) =>
    ["operational-alerts", window] as const,
  dataPipelineHealth: (environment: string, partition = "current") =>
    ["data-pipeline", "health", environment, partition] as const,
  dataPipelineQuality: (
    environment: string,
    partition = "current",
    windowDays = 1,
  ) =>
    ["data-pipeline", "quality", environment, partition, windowDays] as const,
  dataPipelineSharedServiceUsage: (
    environment: string,
    partition = "current",
    windowDays = 1,
  ) =>
    [
      "data-pipeline",
      "shared-service-usage",
      environment,
      partition,
      windowDays,
    ] as const,
  dataPipelineGatewayDecisions: (
    environment: string,
    partition = "current",
    windowDays = 1,
  ) =>
    [
      "data-pipeline",
      "gateway-decisions",
      environment,
      partition,
      windowDays,
    ] as const,
  dataPipelineCost: (
    environment: string,
    partition = "current",
    windowDays = 1,
  ) => ["data-pipeline", "cost", environment, partition, windowDays] as const,
  dataPipelineDecisionSignals: (
    environment: string,
    partition = "current",
    windowDays = 1,
  ) =>
    [
      "data-pipeline",
      "decision-signals",
      environment,
      partition,
      windowDays,
    ] as const,
  confluentPipelineStatus: (serviceId: string, topicName?: string) =>
    [
      "confluent",
      "pipeline-status",
      serviceId,
      topicName ?? "default",
    ] as const,
  topicOnboardingState: (topicName: string) =>
    ["topic-onboarding-state", topicName] as const,
  smokeTests: ["smoke-tests"] as const,
  readiness: ["readiness"] as const,
  managementSession: ["management-session"] as const,
  sharedServiceSecretStatus: ["secret-status", "shared-services"] as const,
  tribeSecretStatus: (serviceId: string, environment = "test") =>
    ["secret-status", "tribe", serviceId, environment] as const,
  contract: (serviceId: string) => ["contract", serviceId] as const,
};
