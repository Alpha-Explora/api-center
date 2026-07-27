import { buildServiceLifecycle } from "@/lib/service-lifecycle";
import type { QuotaPolicy, ServiceRegistryEntry } from "@/lib/schemas";
import { buildDeveloperPortalActions } from "@/components/developer-portal-preview/developer-portal-actions";

export function buildPortalPreview({
  tribeId,
  services,
  quotaPolicies,
}: {
  tribeId: string;
  services: ServiceRegistryEntry[];
  quotaPolicies: QuotaPolicy[];
}) {
  const ownedServices = services.filter((service) => {
    if ((service.serviceType ?? "tribe") !== "tribe") return false;
    return (service.ownerTribeId ?? service.serviceId) === tribeId;
  });
  const allowedIds = new Set(
    ownedServices.flatMap((service) => service.consumes ?? []),
  );
  const allowedServices = services.filter((service) =>
    allowedIds.has(service.serviceId),
  );
  const allowedScopes = [
    ...new Set(allowedServices.flatMap((service) => service.requiredScopes)),
  ];
  const activePolicies = quotaPolicies.filter(
    (policy) => policy.status === "active",
  );
  const tenantTopicPrefix = `tribe.${tribeId}.`;

  const lifecycleEntries = ownedServices.map((service) =>
    buildServiceLifecycle({
      service,
      services,
      quotaPolicies: activePolicies,
      quotaUsage: [],
    }),
  );

  return {
    tribeId,
    ownedServices,
    allowedServices,
    allowedScopes,
    quotaPolicies: activePolicies,
    supportContact: ownedServices[0]?.contact ?? "APICenter platform support",
    recommendedTopics: [
      `${tenantTopicPrefix}events`,
      `${tenantTopicPrefix}commands`,
      `${tenantTopicPrefix}audit`,
    ],
    lifecycleEntries,
    actions: buildDeveloperPortalActions({
      tribeId,
      lifecycleEntries,
      quotaPolicies: activePolicies,
    }),
    checklist: [
      {
        key: "registered_service",
        label: "Registered service",
        complete: ownedServices.length > 0,
      },
      {
        key: "allowed_services",
        label: "Allowed services",
        complete: allowedServices.length > 0,
      },
      {
        key: "quota_policy",
        label: "Quota policy",
        complete: activePolicies.length > 0,
      },
      {
        key: "event_topic",
        label: "Event topic",
        complete: true,
      },
    ],
  };
}

export function formatQuota(policy: QuotaPolicy) {
  return `${policy.maxRequests.toLocaleString()} / ${policy.windowSeconds}s`;
}
