import {
  apiProductListResponseSchema,
  assignTribePlanInputSchema,
  assignTribePlanResponseSchema,
  auditEventsResponseSchema,
  consumerScorecardResponseSchema,
  gatewayTrafficResponseSchema,
  governanceDriftResponseSchema,
  operationalAlertsResponseSchema,
  platformLifecycleResponseSchema,
  promotionEvidenceResponseSchema,
  providerUsageResponseSchema,
  runtimeDependencyMapResponseSchema,
  tribePlanAssignmentsResponseSchema,
  tribePlanDefinitionsResponseSchema,
  type ApiProduct,
  type AssignTribePlanInput,
  type AssignTribePlanResult,
  type AuditEvent,
  type ConsumerScorecard,
  type DependencyEdge,
  type GatewayTrafficSummary,
  type GovernanceDriftItem,
  type OperationalAlert,
  type PlatformLifecycle,
  type PromotionEvidenceSection,
  type ProviderUsage,
  type ServiceRegistryEntry,
  type SharedServiceUsageWindow,
  type TribePlanAssignment,
  type TribePlanDefinition,
} from "@/lib/schemas";
import { request } from "@/lib/api-center/client-core";
import { listServices } from "@/lib/api-center/registry-client";
import {
  toPlanStorageEnvironment,
  type PipelineLane,
  type RuntimeEnvironment,
} from "@/lib/environment-names";

export type OperationalTrustUnavailableSection = {
  key: "dependencies" | "scorecards";
  label: string;
  reason: string;
};

export async function compareGovernanceDrift(snapshot: unknown): Promise<{
  status: string;
  items: GovernanceDriftItem[];
}> {
  const data = await request<unknown>("/api/local/operations/drift", {
    method: "POST",
    body: JSON.stringify(snapshot),
  });

  return governanceDriftResponseSchema.parse(data).data;
}

export async function getRuntimeDependencyEdges(): Promise<DependencyEdge[]> {
  const data = await request<unknown>("/api/local/operations/dependencies");
  return runtimeDependencyMapResponseSchema.parse(data).data.edges;
}

export async function getPromotionEvidence(
  serviceId: string,
): Promise<PromotionEvidenceSection[]> {
  const data = await request<unknown>(
    `/api/local/operations/evidence/${encodeURIComponent(serviceId)}`,
  );
  return promotionEvidenceResponseSchema.parse(data).data.sections;
}

export async function getPlatformLifecycleEvidence(): Promise<PlatformLifecycle> {
  const data = await request<unknown>("/api/local/operations/lifecycle");
  return platformLifecycleResponseSchema.parse(data).data;
}

export async function getMarketplaceProducts(): Promise<ApiProduct[]> {
  const data = await request<unknown>("/api/local/catalog/products");
  return apiProductListResponseSchema.parse(data).data;
}

export async function getConsumerScorecards(): Promise<ConsumerScorecard[]> {
  const data = await request<unknown>("/api/local/operations/scorecards");
  return consumerScorecardResponseSchema.parse(data).data;
}

export async function getOperationalTrustData(): Promise<{
  driftItems: GovernanceDriftItem[];
  dependencyEdges: DependencyEdge[];
  evidenceSections: PromotionEvidenceSection[];
  scorecards: ConsumerScorecard[];
  unavailableSections: OperationalTrustUnavailableSection[];
}> {
  let registryFallback: Promise<ServiceRegistryEntry[]> | undefined;
  const loadRegistryFallback = () => {
    registryFallback = registryFallback ?? listServices().catch(() => []);
    return registryFallback;
  };
  const [dependencyEdges, scorecards] = await Promise.all([
    getOperationalTrustSection({
      key: "dependencies",
      label: "Runtime dependency map",
      load: getRuntimeDependencyEdges,
      fallback: async () =>
        buildRegistryDependencyEdges(await loadRegistryFallback()),
    }),
    getOperationalTrustSection({
      key: "scorecards",
      label: "Consumer scorecards",
      load: getConsumerScorecards,
      fallback: async () =>
        buildRegistryConsumerScorecards(await loadRegistryFallback()),
    }),
  ]);
  const unavailableSections = [
    dependencyEdges.unavailable,
    scorecards.unavailable,
  ].filter((section) => section !== undefined);

  return {
    driftItems: [],
    dependencyEdges: dependencyEdges.data,
    evidenceSections: [],
    scorecards: scorecards.data,
    unavailableSections,
  };
}

async function getOperationalTrustSection<T>({
  key,
  label,
  load,
  fallback,
}: {
  key: OperationalTrustUnavailableSection["key"];
  label: string;
  load: () => Promise<T>;
  fallback: () => Promise<T>;
}): Promise<{
  data: T;
  unavailable?: OperationalTrustUnavailableSection;
}> {
  try {
    return { data: await load() };
  } catch (error) {
    return {
      data: await fallback(),
      unavailable: {
        key,
        label,
        reason:
          error instanceof Error && error.message.trim()
            ? error.message
            : "Section data could not be loaded.",
      },
    };
  }
}

function buildRegistryDependencyEdges(
  services: ServiceRegistryEntry[],
): DependencyEdge[] {
  const serviceEdges = services.flatMap((service) =>
    service.consumes.map((target) => ({
      from: service.serviceId,
      to: target,
      type: target === "kafka" ? "kafka" : "shared-service",
    })),
  );
  const topicEdgesByKey = new Map<string, DependencyEdge>();
  for (const service of services.filter((entry) =>
    entry.consumes.includes("kafka"),
  )) {
    const ownerTribeId = service.ownerTribeId ?? service.serviceId;
    const edge = {
      from: ownerTribeId,
      to: `tribe.${ownerTribeId}.events`,
      type: "kafka-topic",
    };
    topicEdgesByKey.set(`${edge.from}:${edge.to}:${edge.type}`, edge);
  }
  const topicEdges = [...topicEdgesByKey.values()];

  return [...serviceEdges, ...topicEdges];
}

function buildRegistryConsumerScorecards(
  services: ServiceRegistryEntry[],
): ConsumerScorecard[] {
  const byOwner = new Map<string, ServiceRegistryEntry[]>();
  for (const service of services) {
    const ownerTribeId = service.ownerTribeId ?? service.serviceId;
    byOwner.set(ownerTribeId, [...(byOwner.get(ownerTribeId) ?? []), service]);
  }

  return [...byOwner.entries()]
    .map(([ownerTribeId, ownerServices]) => {
      const findings = buildRegistryScorecardFindings(ownerServices);

      return {
        ownerTribeId,
        status: findings.length ? "needs_attention" : "healthy",
        sdkVersion: "unknown",
        latestSdkVersion:
          process.env.NEXT_PUBLIC_APICENTER_SDK_CONTRACT_VERSION ??
          process.env.APICENTER_SDK_CONTRACT_VERSION ??
          "unknown",
        quotaUsagePercent: "unknown" as const,
        errorRatePercent: "unknown" as const,
        findings:
          findings.length > 0
            ? findings
            : ["Registry fallback found no service manifest issues."],
      };
    })
    .sort((left, right) => left.ownerTribeId.localeCompare(right.ownerTribeId));
}

function buildRegistryScorecardFindings(services: ServiceRegistryEntry[]) {
  const findings = [
    "Scorecard metrics are unavailable; using registry-derived checks.",
  ];

  if (services.some((service) => service.healthy === false)) {
    findings.push("At least one service health check is failing.");
  }
  if (services.some((service) => service.status !== "active")) {
    findings.push("At least one service is not active.");
  }
  if (services.some((service) => !service.contact || !service.ownerTeam)) {
    findings.push("Owner contact metadata is incomplete.");
  }
  if (services.some((service) => !service.healthCheck)) {
    findings.push("Health check path is not registered for every service.");
  }

  return findings;
}

export async function listMarketplaceProducts(): Promise<ApiProduct[]> {
  return getMarketplaceProducts();
}

export async function listTribePlanDefinitions(): Promise<
  TribePlanDefinition[]
> {
  const data = await request<unknown>("/api/local/plans/definitions");

  return tribePlanDefinitionsResponseSchema.parse(data).data;
}

export async function listTribePlanAssignments(input?: {
  ownerTribeId?: string;
  environment?: RuntimeEnvironment | PipelineLane;
  status?: string;
}): Promise<TribePlanAssignment[]> {
  const params = new URLSearchParams();
  if (input?.ownerTribeId) params.set("ownerTribeId", input.ownerTribeId);
  if (input?.environment) {
    params.set("environment", toPlanStorageEnvironment(input.environment));
  }
  if (input?.status) params.set("status", input.status);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const data = await request<unknown>(`/api/local/plans/assignments${suffix}`);

  return tribePlanAssignmentsResponseSchema.parse(data).data;
}

export async function assignTribePlan(
  input: Omit<AssignTribePlanInput, "environment"> & {
    environment: RuntimeEnvironment | PipelineLane;
  },
): Promise<AssignTribePlanResult> {
  const payload = assignTribePlanInputSchema.parse({
    ...input,
    environment: toPlanStorageEnvironment(input.environment),
  });
  const data = await request<unknown>("/api/local/plans/assignments", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return assignTribePlanResponseSchema.parse(data).data;
}

export async function getGatewayTraffic(
  window: SharedServiceUsageWindow = "24h",
): Promise<GatewayTrafficSummary> {
  const data = await request<unknown>(
    `/api/local/analytics/gateway-traffic?window=${encodeURIComponent(window)}`,
  );

  return gatewayTrafficResponseSchema.parse(data).data;
}

export async function getAuditEvents(input?: {
  limit?: number;
  serviceId?: string;
  type?: string;
  actionFamily?: string;
  actor?: string;
}): Promise<AuditEvent[]> {
  const params = new URLSearchParams();
  if (input?.limit) params.set("limit", String(input.limit));
  if (input?.serviceId) params.set("serviceId", input.serviceId);
  if (input?.type) params.set("type", input.type);
  if (input?.actionFamily) params.set("actionFamily", input.actionFamily);
  if (input?.actor) params.set("actor", input.actor);

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const data = await request<unknown>(`/api/local/audit/events${suffix}`);

  return auditEventsResponseSchema.parse(data).data;
}

export async function getProviderUsage(
  window: SharedServiceUsageWindow = "24h",
): Promise<ProviderUsage[]> {
  const data = await request<unknown>(
    `/api/local/analytics/provider-usage?window=${encodeURIComponent(window)}`,
  );

  return providerUsageResponseSchema.parse(data).data;
}

export async function getOperationalAlerts(
  window: SharedServiceUsageWindow = "1h",
): Promise<OperationalAlert[]> {
  const data = await request<unknown>(
    `/api/local/analytics/alerts?window=${encodeURIComponent(window)}`,
  );

  return operationalAlertsResponseSchema.parse(data).data;
}
