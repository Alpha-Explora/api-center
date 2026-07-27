import type {
  ServiceRegistryEntry,
  SharedServiceRuntimeUsage,
} from "@/lib/schemas";

export function isTribeService(service: ServiceRegistryEntry) {
  return (service.serviceType ?? "tribe") === "tribe";
}

export function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatLastUsed(value: string | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export function getRuntimeForTribe(
  runtimeUsage: SharedServiceRuntimeUsage[],
  tribeServiceId: string,
) {
  return runtimeUsage
    .filter((usage) => usage.tribeServiceId === tribeServiceId)
    .sort((a, b) => b.totalRequests - a.totalRequests);
}

export function getRuntimeForSharedService(
  runtimeUsage: SharedServiceRuntimeUsage[],
  sharedServiceId: string,
) {
  return runtimeUsage
    .filter((usage) => usage.sharedServiceId === sharedServiceId)
    .sort((a, b) => b.totalRequests - a.totalRequests);
}

export function getSharedServiceName(
  services: ServiceRegistryEntry[],
  sharedServiceId: string,
) {
  return (
    services.find((service) => service.serviceId === sharedServiceId)?.name ??
    sharedServiceId
  );
}

export function getTribeName(
  services: ServiceRegistryEntry[],
  tribeServiceId: string,
) {
  return (
    services.find((service) => service.serviceId === tribeServiceId)?.name ??
    tribeServiceId
  );
}

