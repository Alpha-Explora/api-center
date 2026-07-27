import { getServiceEventTopics } from "@/lib/event-topics";
import type { ServiceManifest, ServiceRegistryEntry } from "@/lib/schemas";

export type OwnerTribeMigrationAction =
  | "already-current"
  | "set-owner"
  | "manual-review";

export type OwnerTribeMigrationItem = {
  serviceId: string;
  action: OwnerTribeMigrationAction;
  currentOwnerTribeId?: string;
  nextOwnerTribeId?: string;
  eventTopic?: string;
  reason: string;
};

export type OwnerTribeMigrationPlan = {
  canApply: boolean;
  items: OwnerTribeMigrationItem[];
  updateManifests: ServiceManifest[];
};

export function buildOwnerTribeMigrationPlan(input: {
  services: ServiceRegistryEntry[];
  ownerOverrides?: Record<string, string>;
}): OwnerTribeMigrationPlan {
  const ownerOverrides = input.ownerOverrides ?? {};
  const tribeServiceIds = new Set(
    input.services
      .filter((service) => (service.serviceType ?? "tribe") !== "shared")
      .map((service) => service.serviceId),
  );
  const items: OwnerTribeMigrationItem[] = [];
  const updateManifests: ServiceManifest[] = [];

  for (const service of input.services) {
    if ((service.serviceType ?? "tribe") === "shared") {
      items.push({
        serviceId: service.serviceId,
        action: "already-current",
        currentOwnerTribeId: service.ownerTribeId,
        nextOwnerTribeId: service.ownerTribeId ?? service.serviceId,
        reason: "Shared services keep their own service identity.",
      });
      continue;
    }

    if (service.ownerTribeId) {
      items.push({
        serviceId: service.serviceId,
        action: "already-current",
        currentOwnerTribeId: service.ownerTribeId,
        nextOwnerTribeId: service.ownerTribeId,
        eventTopic: getServiceEventTopics(service).primary,
        reason: "Service already has ownerTribeId.",
      });
      continue;
    }

    const nextOwnerTribeId =
      ownerOverrides[service.serviceId] ??
      inferOwnerTribeId(service.serviceId, tribeServiceIds);

    if (!nextOwnerTribeId) {
      items.push({
        serviceId: service.serviceId,
        action: "manual-review",
        reason:
          "No ownerTribeId exists and no matching root tribe service could be inferred.",
      });
      continue;
    }

    const manifest = registryEntryToManifest(service, nextOwnerTribeId);
    updateManifests.push(manifest);
    items.push({
      serviceId: service.serviceId,
      action: "set-owner",
      nextOwnerTribeId,
      eventTopic: getServiceEventTopics({
        serviceId: service.serviceId,
        ownerTribeId: nextOwnerTribeId,
        serviceType: "tribe",
      }).primary,
      reason:
        nextOwnerTribeId === service.serviceId
          ? "Treating service as the root tribe registration."
          : `Inferred owner tribe '${nextOwnerTribeId}' for service '${service.serviceId}'.`,
    });
  }

  return {
    canApply: items.every((item) => item.action !== "manual-review"),
    items,
    updateManifests,
  };
}

function inferOwnerTribeId(serviceId: string, tribeServiceIds: Set<string>) {
  if (!serviceId.includes("-")) return serviceId;

  const candidates = [...tribeServiceIds]
    .filter((candidate) => serviceId.startsWith(`${candidate}-`))
    .sort((left, right) => right.length - left.length);

  return candidates[0];
}

function registryEntryToManifest(
  service: ServiceRegistryEntry,
  ownerTribeId: string,
): ServiceManifest {
  const {
    registeredAt,
    updatedAt,
    status,
    previousVersion,
    healthy,
    lastHealthCheckAt,
    ...manifest
  } = service;
  void [
    registeredAt,
    updatedAt,
    status,
    previousVersion,
    healthy,
    lastHealthCheckAt,
  ];

  return {
    ...manifest,
    ownerTribeId,
    serviceType: manifest.serviceType ?? "tribe",
  };
}
