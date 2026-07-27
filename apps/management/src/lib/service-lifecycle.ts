import type {
  QuotaPolicy,
  QuotaUsageDecision,
  ServiceRegistryEntry,
} from "./schemas";

export type ServiceLifecycleStatus = "blocked" | "attention" | "ready";

export type ServiceLifecycleStageStatus =
  | "complete"
  | "attention"
  | "blocked"
  | "not-required";

export type ServiceLifecycleStageId =
  | "registry"
  | "ownership"
  | "dependencies"
  | "runtime"
  | "quotas"
  | "pipeline"
  | "promotion"
  | "evidence";

export type ServiceLifecycleStage = {
  id: ServiceLifecycleStageId;
  label: string;
  status: ServiceLifecycleStageStatus;
  evidence: string;
  source?: string;
  action: string;
  href: string;
};

export type ServiceLifecycleEntry = {
  service: ServiceRegistryEntry;
  ownerTribeId: string;
  status: ServiceLifecycleStatus;
  stages: ServiceLifecycleStage[];
  blockedCount: number;
  attentionCount: number;
  nextAction: {
    stageId: ServiceLifecycleStageId;
    label: string;
    href: string;
  };
};

export type PlatformLifecycle = {
  generatedAt?: string;
  entries: ServiceLifecycleEntry[];
  summary: {
    total: number;
    blocked: number;
    attention: number;
    ready: number;
  };
};

export function buildPlatformLifecycle({
  services,
  quotaPolicies,
  quotaUsage,
}: {
  services: ServiceRegistryEntry[];
  quotaPolicies: QuotaPolicy[];
  quotaUsage: QuotaUsageDecision[];
}): PlatformLifecycle {
  const entries = services
    .map((service) =>
      buildServiceLifecycle({ service, services, quotaPolicies, quotaUsage }),
    )
    .sort(compareLifecycleEntries);

  return {
    entries,
    summary: {
      total: entries.length,
      blocked: entries.filter((entry) => entry.status === "blocked").length,
      attention: entries.filter((entry) => entry.status === "attention").length,
      ready: entries.filter((entry) => entry.status === "ready").length,
    },
  };
}

export function buildServiceLifecycle({
  service,
  services,
  quotaPolicies,
  quotaUsage,
}: {
  service: ServiceRegistryEntry;
  services: ServiceRegistryEntry[];
  quotaPolicies: QuotaPolicy[];
  quotaUsage: QuotaUsageDecision[];
}): ServiceLifecycleEntry {
  const ownerTribeId = getOwnerTribeId(service);
  const activeQuotaPolicies = quotaPolicies.filter(
    (policy) =>
      policy.ownerTribeId === ownerTribeId && policy.status === "active",
  );
  const ownerQuotaUsage = quotaUsage.filter(
    (usage) => usage.ownerTribeId === ownerTribeId,
  );
  const stages = [
    registryStage(service),
    ownershipStage(service, ownerTribeId),
    dependenciesStage(service, services),
    runtimeStage(service),
    quotaStage(service, activeQuotaPolicies, ownerQuotaUsage),
    pipelineStage(service),
    promotionStage(service, activeQuotaPolicies),
    evidenceStage(service),
  ];
  const blockedCount = stages.filter((stage) => stage.status === "blocked").length;
  const attentionCount = stages.filter(
    (stage) => stage.status === "attention",
  ).length;
  const nextStage =
    stages.find((stage) => stage.status === "blocked") ??
    stages.find((stage) => stage.status === "attention");

  return {
    service,
    ownerTribeId,
    status:
      blockedCount > 0 ? "blocked" : attentionCount > 0 ? "attention" : "ready",
    stages,
    blockedCount,
    attentionCount,
    nextAction: nextStage
      ? {
          stageId: nextStage.id,
          label: nextStage.action,
          href: nextStage.href,
        }
      : {
          stageId: "registry",
          label: "Open the service detail record.",
          href: `/tribes/${service.serviceId}`,
        },
  };
}

export function getOwnerTribeId(service: ServiceRegistryEntry) {
  return service.ownerTribeId || service.serviceId;
}

export function requiresEventExport(service: ServiceRegistryEntry) {
  return (
    service.requiredScopes.includes("external:kafka:write") ||
    service.consumes.includes("kafka")
  );
}

function registryStage(service: ServiceRegistryEntry): ServiceLifecycleStage {
  if (service.status === "retired") {
    return stage(
      "registry",
      "Registry",
      "blocked",
      "The service is retired.",
      "Restore or replace the registry entry before lifecycle work continues.",
      `/tribes/${service.serviceId}`,
    );
  }

  if (service.status === "deprecated") {
    return stage(
      "registry",
      "Registry",
      "attention",
      "The service is deprecated.",
      "Confirm the replacement path before new consumers onboard.",
      `/tribes/${service.serviceId}?section=governance`,
    );
  }

  if (service.status === "proposed") {
    return stage(
      "registry",
      "Registry",
      "attention",
      "The service is proposed but not active.",
      "Approve or activate the service when validation is complete.",
      `/tribes/${service.serviceId}?section=actions`,
    );
  }

  return stage(
    "registry",
    "Registry",
    "complete",
    "The service is active in the registry.",
    "Open the service detail record.",
    `/tribes/${service.serviceId}`,
  );
}

function ownershipStage(
  service: ServiceRegistryEntry,
  ownerTribeId: string,
): ServiceLifecycleStage {
  const missing = [
    service.ownerTeam?.trim() ? "" : "owner team",
    service.contact?.trim() ? "" : "contact",
    ownerTribeId ? "" : "owner tribe",
  ].filter(Boolean);

  if (missing.length) {
    return stage(
      "ownership",
      "Ownership",
      "blocked",
      `Missing ${missing.join(", ")}.`,
      "Update owner and contact fields in the manifest.",
      `/tribes/${service.serviceId}/edit`,
    );
  }

  return stage(
    "ownership",
    "Ownership",
    "complete",
    `${service.ownerTeam} owns ${ownerTribeId}.`,
    "Review governance evidence.",
    `/tribes/${service.serviceId}?section=governance`,
  );
}

function dependenciesStage(
  service: ServiceRegistryEntry,
  services: ServiceRegistryEntry[],
): ServiceLifecycleStage {
  const registeredServiceIds = new Set(services.map((entry) => entry.serviceId));
  const brokenDependencies = service.consumes.filter(
    (dependency) =>
      dependency !== "kafka" && !registeredServiceIds.has(dependency),
  );

  if (brokenDependencies.length) {
    return stage(
      "dependencies",
      "Dependencies",
      "blocked",
      `${brokenDependencies.length} consumed service link is unresolved.`,
      "Register the target service or remove the stale consume edge.",
      serviceDetailHref(service, "dependencies"),
    );
  }

  return stage(
    "dependencies",
    "Dependencies",
    "complete",
    service.consumes.length
      ? `${service.consumes.length} dependency link is registered or externally handled.`
      : "No consumed services are declared.",
    "Inspect dependency impact.",
    `/tribes/${service.serviceId}?section=dependencies`,
  );
}

function runtimeStage(service: ServiceRegistryEntry): ServiceLifecycleStage {
  if (!service.healthCheck?.trim()) {
    return stage(
      "runtime",
      "Runtime",
      "attention",
      "No health path is registered.",
      "Add a health path and run a service health check.",
      `/tribes/${service.serviceId}?section=health`,
    );
  }

  if (service.healthy === false) {
    return stage(
      "runtime",
      "Runtime",
      "blocked",
      "The latest health check failed.",
      "Open health checks and rerun the failing endpoint.",
      `/tribes/${service.serviceId}?section=health`,
    );
  }

  if (service.healthy !== true) {
    return stage(
      "runtime",
      "Runtime",
      "attention",
      "No passing health check is recorded yet.",
      "Run Check health from the service detail page.",
      `/tribes/${service.serviceId}?section=health`,
    );
  }

  return stage(
    "runtime",
    "Runtime",
    "complete",
    `Passed${service.lastHealthCheckAt ? ` at ${service.lastHealthCheckAt}` : ""}.`,
    "Review runtime evidence.",
    `/tribes/${service.serviceId}?section=evidence`,
  );
}

function quotaStage(
  service: ServiceRegistryEntry,
  activeQuotaPolicies: QuotaPolicy[],
  ownerQuotaUsage: QuotaUsageDecision[],
): ServiceLifecycleStage {
  if ((service.serviceType ?? "tribe") === "shared") {
    return stage(
      "quotas",
      "Quotas",
      "not-required",
      "Provider-side service quotas are reviewed through consumer policies.",
      "Inspect consuming tribe quota pressure.",
      serviceDetailHref(service, "quotas"),
    );
  }

  const blockedUsage = ownerQuotaUsage.find((usage) => usage.outcome === "blocked");
  if (blockedUsage) {
    return stage(
      "quotas",
      "Quotas",
      "blocked",
      `${blockedUsage.requestCount} of ${blockedUsage.maxRequests} requests used and traffic is blocked.`,
      "Review the quota policy or approve a quota increase.",
      serviceDetailHref(service, "quotas"),
    );
  }

  const warningUsage = ownerQuotaUsage.find(
    (usage) =>
      usage.outcome !== "allowed" ||
      usage.forecast?.status === "warning" ||
      usage.requestCount / usage.maxRequests >= 0.9,
  );
  if (warningUsage) {
    return stage(
      "quotas",
      "Quotas",
      "attention",
      `${warningUsage.requestCount} of ${warningUsage.maxRequests} requests used.`,
      "Review usage before promoting or expanding consumers.",
      serviceDetailHref(service, "quotas"),
    );
  }

  if (!activeQuotaPolicies.length) {
    return stage(
      "quotas",
      "Quotas",
      "attention",
      "No active observe or enforce policy exists.",
      "Create an observe-mode quota policy.",
      serviceDetailHref(service, "quotas"),
    );
  }

  return stage(
    "quotas",
    "Quotas",
    "complete",
    `${activeQuotaPolicies.length} active quota policy is visible.`,
    "Review quota policy.",
    serviceDetailHref(service, "quotas"),
  );
}

function pipelineStage(service: ServiceRegistryEntry): ServiceLifecycleStage {
  if (!requiresEventExport(service)) {
    return stage(
      "pipeline",
      "Pipeline",
      "not-required",
      "Event export is not required for this service.",
      "Open pipeline only when publishing is added.",
      `/tribes/${service.serviceId}?section=pipeline`,
    );
  }

  return stage(
    "pipeline",
    "Pipeline",
    "attention",
    "Event topic and S3 sink evidence must be checked before live promotion.",
    "Verify topic and S3 sink inclusion.",
    `/tribes/${service.serviceId}?section=pipeline`,
  );
}

function promotionStage(
  service: ServiceRegistryEntry,
  activeQuotaPolicies: QuotaPolicy[],
): ServiceLifecycleStage {
  const promotionBlocked =
    service.status === "retired" ||
    !service.ownerTeam?.trim() ||
    !service.contact?.trim() ||
    service.healthy === false;

  if (promotionBlocked) {
    return stage(
      "promotion",
      "Promotion",
      "blocked",
      "Required registry, owner, or runtime evidence is missing.",
      "Open promotion gates after resolving blocked lifecycle stages.",
      serviceDetailHref(service, "governance"),
    );
  }

  if (
    ((service.serviceType ?? "tribe") === "tribe" &&
      !activeQuotaPolicies.length) ||
    service.healthy !== true
  ) {
    return stage(
      "promotion",
      "Promotion",
      "attention",
      "Promotion needs quota and health evidence.",
      "Review live promotion gates.",
      serviceDetailHref(service, "governance"),
    );
  }

  return stage(
    "promotion",
    "Promotion",
    "complete",
    "Core promotion inputs are present.",
    "Review live promotion gates.",
    serviceDetailHref(service, "governance"),
  );
}

function serviceDetailHref(service: ServiceRegistryEntry, section: string) {
  return `/tribes/${service.serviceId}?section=${section}`;
}

function evidenceStage(service: ServiceRegistryEntry): ServiceLifecycleStage {
  if (!service.lastHealthCheckAt) {
    return stage(
      "evidence",
      "Evidence",
      "attention",
      `Registry updated at ${service.updatedAt}. Health evidence is not recorded.`,
      "Open the evidence timeline and add runtime proof.",
      `/tribes/${service.serviceId}?section=evidence`,
    );
  }

  return stage(
    "evidence",
    "Evidence",
    "complete",
    `Latest health proof at ${service.lastHealthCheckAt}.`,
    "Open the evidence timeline.",
    `/tribes/${service.serviceId}?section=evidence`,
  );
}

function stage(
  id: ServiceLifecycleStageId,
  label: string,
  status: ServiceLifecycleStageStatus,
  evidence: string,
  action: string,
  href: string,
): ServiceLifecycleStage {
  return { id, label, status, evidence, action, href };
}

function compareLifecycleEntries(
  a: ServiceLifecycleEntry,
  b: ServiceLifecycleEntry,
) {
  const statusRank: Record<ServiceLifecycleStatus, number> = {
    blocked: 0,
    attention: 1,
    ready: 2,
  };

  return (
    statusRank[a.status] - statusRank[b.status] ||
    b.blockedCount - a.blockedCount ||
    b.attentionCount - a.attentionCount ||
    a.service.name.localeCompare(b.service.name)
  );
}
