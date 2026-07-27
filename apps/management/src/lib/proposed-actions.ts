import { getBrokenDependencies } from "@/lib/registry-view";
import { expectedSharedServiceIds } from "@/lib/shared-service-usage";
import type {
  ConfluentPipelineStatusResponse,
  QuotaPolicy,
  QuotaUsageDecision,
  ServiceRegistryEntry,
  TribeSecretStatusResponse,
} from "@/lib/schemas";

export type ProposedAction = {
  id: string;
  title: string;
  description: string;
  serviceId?: string;
  risk: "read" | "low-write" | "state-write" | "provider-write" | "destructive";
  execution: "proposal";
  href: string;
  reason: string;
  expiresAt: string;
};

type PipelineStatus = ConfluentPipelineStatusResponse["data"];
type TribeSecretStatus = TribeSecretStatusResponse["data"];

export function buildQuotaProposedActions(input: {
  services: ServiceRegistryEntry[];
  policies: QuotaPolicy[];
  usage: QuotaUsageDecision[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const actions: ProposedAction[] = [];
  const activePolicies = input.policies.filter(
    (policy) => policy.status === "active",
  );
  const activePolicyOwners = new Set(
    activePolicies.map((policy) => policy.ownerTribeId),
  );

  for (const service of input.services) {
    if (
      isProductionTribe(service) &&
      !activePolicyOwners.has(ownerFor(service))
    ) {
      actions.push({
        id: `${ownerFor(service)}-create-active-quota`,
        title: "Create active quota policy",
        description: "No active quota policy exists for this production tribe.",
        serviceId: service.serviceId,
        risk: "state-write",
        execution: "proposal",
        href: quotaHref(ownerFor(service)),
        reason: "Missing production tribe quota",
        expiresAt: proposalExpiry(now),
      });
    }
  }

  for (const ownerTribeId of ownersWithObservedExceedance(input.usage, now)) {
    actions.push({
      id: `${ownerTribeId}-review-observe-quota-exceeded`,
      title: "Review observe-mode quota exceedance",
      description:
        "An observe-mode quota was exceeded in the last 24 hours. Review usage before enforcing.",
      serviceId: ownerTribeId,
      risk: "read",
      execution: "proposal",
      href: quotaHref(ownerTribeId),
      reason: "Observe-mode quota exceeded",
      expiresAt: proposalExpiry(now),
    });
  }

  for (const ownerTribeId of ownersWithHighBlockRate(input.usage, now)) {
    actions.push({
      id: `${ownerTribeId}-review-enforced-quota-blocks`,
      title: "Review enforced quota blocks",
      description:
        "An enforce-mode quota blocked more than 5% of recent calls in the last hour.",
      serviceId: ownerTribeId,
      risk: "read",
      execution: "proposal",
      href: quotaHref(ownerTribeId),
      reason: "High enforced quota block rate",
      expiresAt: proposalExpiry(now),
    });
  }

  for (const service of input.services) {
    if (
      service.serviceType === "shared" &&
      service.quotaHints?.providerCostSensitive &&
      !hasTargetSpecificPolicy(activePolicies, service.serviceId)
    ) {
      actions.push({
        id: `${service.serviceId}-create-target-quota`,
        title: `Create target quota for ${service.serviceId}`,
        description:
          "Provider-cost-sensitive shared service has no active target-specific quota.",
        serviceId: service.serviceId,
        risk: "state-write",
        execution: "proposal",
        href: serviceDetailHref(service.serviceId, "quotas"),
        reason: "Missing provider-cost-sensitive target quota",
        expiresAt: proposalExpiry(now),
      });
    }
  }

  return actions;
}

export function buildRegistryProposedActions(
  services: ServiceRegistryEntry[],
  now: Date = new Date(),
) {
  const actions: ProposedAction[] = [];
  const serviceIds = new Set(services.map((service) => service.serviceId));

  for (const sharedServiceId of expectedSharedServiceIds) {
    if (!serviceIds.has(sharedServiceId)) {
      actions.push({
        id: `register-shared-service-${sharedServiceId}`,
        title: `Register ${sharedServiceId} manifest`,
        description:
          "Expected shared-service manifest is missing from the registry.",
        serviceId: sharedServiceId,
        risk: "state-write",
        execution: "proposal",
        href: "/shared-services/setup",
        reason: "Missing shared-service manifest",
        expiresAt: proposalExpiry(now),
      });
    }
  }

  for (const dependency of getBrokenDependencies(services)) {
    actions.push({
      id: `${dependency.sourceServiceId}-fix-missing-${dependency.targetServiceId}`,
      title: `Fix missing dependency ${dependency.targetServiceId}`,
      description: `${dependency.sourceServiceId} consumes a service that is not registered.`,
      serviceId: dependency.sourceServiceId,
      risk: "state-write",
      execution: "proposal",
      href: `/tribes/${encodeURIComponent(dependency.sourceServiceId)}/edit`,
      reason: "Missing shared-service or tribe manifest",
      expiresAt: proposalExpiry(now),
    });
  }

  return actions;
}

export function buildServiceProposedActions(input: {
  service: ServiceRegistryEntry;
  pipelineStatus?: PipelineStatus;
  secretStatus?: TribeSecretStatus;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const actions: ProposedAction[] = [];

  if (!input.service.healthCheck) {
    actions.push({
      id: `${input.service.serviceId}-add-health-path`,
      title: "Add health path",
      description:
        "Readiness and contract testing need a registered health path.",
      serviceId: input.service.serviceId,
      risk: "state-write",
      execution: "proposal",
      href: `/tribes/${encodeURIComponent(input.service.serviceId)}/edit`,
      reason: "Missing healthCheck in manifest",
      expiresAt: proposalExpiry(now),
    });
  }

  if (!input.service.ownerTeam || !input.service.contact) {
    actions.push({
      id: `${input.service.serviceId}-add-owner-contact`,
      title: "Add owner and contact",
      description:
        "Ownership is required for access review and incident handoff.",
      serviceId: input.service.serviceId,
      risk: "state-write",
      execution: "proposal",
      href: `/tribes/${encodeURIComponent(input.service.serviceId)}/edit`,
      reason: "Missing owner metadata",
      expiresAt: proposalExpiry(now),
    });
  }

  if (input.pipelineStatus) {
    actions.push(
      ...buildPipelineActions(input.service, input.pipelineStatus, now),
    );
  }

  if (input.service.serviceType === "tribe" && input.secretStatus) {
    actions.push(...buildSecretActions(input.service, input.secretStatus, now));
  }

  return actions;
}

function buildPipelineActions(
  service: ServiceRegistryEntry,
  status: PipelineStatus,
  now: Date,
) {
  const actions: ProposedAction[] = [];
  const pipelineHref = serviceDetailHref(service.serviceId, "pipeline");

  if (status.topicCheckOk && !status.topicExists) {
    actions.push({
      id: `${service.serviceId}-provision-topic`,
      title: "Provision Confluent topic",
      description: `${status.topicName} is missing.`,
      serviceId: service.serviceId,
      risk: "provider-write",
      execution: "proposal",
      href: pipelineHref,
      reason: "Missing Kafka topic",
      expiresAt: proposalExpiry(now),
    });
  }

  if (
    status.topicCheckOk &&
    status.s3SinkCheckOk &&
    status.topicExists &&
    !status.s3SinkIncludesTopic
  ) {
    actions.push({
      id: `${service.serviceId}-add-topic-to-s3-sink`,
      title: "Add topic to S3 sink",
      description: `${status.topicName} exists but is not included in ${status.connectorName}.`,
      serviceId: service.serviceId,
      risk: "provider-write",
      execution: "proposal",
      href: pipelineHref,
      reason: "Topic not in S3 sink connector",
      expiresAt: proposalExpiry(now),
    });
  }

  if (!status.topicCheckOk || !status.s3SinkCheckOk) {
    actions.push({
      id: `${service.serviceId}-check-confluent-access`,
      title: "Check Confluent access",
      description: "Pipeline status could not be read from Confluent.",
      serviceId: service.serviceId,
      risk: "read",
      execution: "proposal",
      href: pipelineHref,
      reason: "Failed readiness config",
      expiresAt: proposalExpiry(now),
    });
  }

  return actions;
}

function buildSecretActions(
  service: ServiceRegistryEntry,
  status: TribeSecretStatus,
  now: Date,
) {
  if (!status.exists || status.rotationWarning?.stale) {
    const action: ProposedAction = {
      id: status.exists
        ? `${service.serviceId}-rotate-stale-secret`
        : `${service.serviceId}-provision-secret`,
      title: status.exists
        ? "Rotate stale tribe secret"
        : "Provision tribe secret",
      description:
        status.rotationWarning?.message ??
        "Tribe secret hash is missing from Secret Manager.",
      serviceId: service.serviceId,
      risk: "state-write",
      execution: "proposal",
      href: serviceDetailHref(service.serviceId, "actions"),
      reason: status.exists ? "Stale secret" : "Missing tribe secret",
      expiresAt: proposalExpiry(now),
    };

    return [action];
  }

  return [];
}

function proposalExpiry(now: Date) {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function isProductionTribe(service: ServiceRegistryEntry) {
  return (
    service.serviceType === "tribe" &&
    service.status === "active" &&
    service.serviceTier === "critical"
  );
}

function ownerFor(service: ServiceRegistryEntry) {
  return service.ownerTribeId ?? service.serviceId;
}

function quotaHref(ownerTribeId: string) {
  return serviceDetailHref(ownerTribeId, "quotas");
}

function serviceDetailHref(serviceId: string, section: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=${encodeURIComponent(section)}`;
}

function ownersWithObservedExceedance(usage: QuotaUsageDecision[], now: Date) {
  const since = now.getTime() - 24 * 60 * 60 * 1000;
  return uniqueOwners(
    usage.filter(
      (decision) =>
        decision.mode === "observe" &&
        decision.outcome === "observed_exceeded" &&
        Date.parse(decision.createdAt) >= since,
    ),
  );
}

function ownersWithHighBlockRate(usage: QuotaUsageDecision[], now: Date) {
  const since = now.getTime() - 60 * 60 * 1000;
  const recentEnforced = usage.filter(
    (decision) =>
      decision.mode === "enforce" && Date.parse(decision.createdAt) >= since,
  );
  const byOwner = new Map<string, { total: number; blocked: number }>();

  for (const decision of recentEnforced) {
    const summary = byOwner.get(decision.ownerTribeId) ?? {
      total: 0,
      blocked: 0,
    };
    summary.total += 1;
    if (decision.outcome === "blocked") summary.blocked += 1;
    byOwner.set(decision.ownerTribeId, summary);
  }

  return [...byOwner.entries()]
    .filter(
      ([, summary]) =>
        summary.total > 0 && summary.blocked / summary.total > 0.05,
    )
    .map(([ownerTribeId]) => ownerTribeId);
}

function uniqueOwners(decisions: QuotaUsageDecision[]) {
  return [...new Set(decisions.map((decision) => decision.ownerTribeId))];
}

function hasTargetSpecificPolicy(policies: QuotaPolicy[], serviceId: string) {
  return policies.some(
    (policy) =>
      policy.status === "active" &&
      policy.scope === "shared" &&
      policy.targetServiceId === serviceId,
  );
}
