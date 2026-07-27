import type { ServiceRegistryEntry } from "@/lib/schemas";

export function groupServicesByOwner(services: ServiceRegistryEntry[]) {
  return services.reduce<Record<string, ServiceRegistryEntry[]>>(
    (groups, service) => {
      const owner = service.ownerTeam || "Unassigned";
      groups[owner] = groups[owner] ?? [];
      groups[owner].push(service);
      return groups;
    },
    {},
  );
}

export function getRegistrySummary(services: ServiceRegistryEntry[]) {
  return {
    total: services.length,
    tribe: services.filter(
      (service) => (service.serviceType ?? "tribe") === "tribe",
    ).length,
    shared: services.filter((service) => service.serviceType === "shared")
      .length,
    active: services.filter((service) => service.status === "active").length,
    deprecated: services.filter((service) => service.status === "deprecated")
      .length,
    retired: services.filter((service) => service.status === "retired").length,
    unhealthy: services.filter((service) => service.healthy === false).length,
    missingOwner: services.filter(
      (service) => !service.ownerTeam || !service.contact,
    ).length,
    missingHealthPath: services.filter((service) => !service.healthCheck)
      .length,
  };
}

export function getConsumersForService(
  services: ServiceRegistryEntry[],
  targetServiceId: string,
) {
  return services
    .filter((service) => service.consumes.includes(targetServiceId))
    .map((service) => service.serviceId);
}

export function getBrokenDependencies(services: ServiceRegistryEntry[]) {
  const serviceIds = new Set(services.map((service) => service.serviceId));
  return services.flatMap((service) =>
    service.consumes
      .filter((targetServiceId) => !serviceIds.has(targetServiceId))
      .map((targetServiceId) => ({
        sourceServiceId: service.serviceId,
        targetServiceId,
      })),
  );
}

export function getDependencyRows(services: ServiceRegistryEntry[]) {
  const byId = new Map(services.map((service) => [service.serviceId, service]));

  return services.flatMap((service) =>
    service.consumes.map((targetServiceId) => {
      const target = byId.get(targetServiceId);
      return {
        sourceServiceId: service.serviceId,
        targetServiceId,
        targetType: target?.serviceType ?? "unknown",
        targetStatus: target?.status ?? "missing",
      };
    }),
  );
}
