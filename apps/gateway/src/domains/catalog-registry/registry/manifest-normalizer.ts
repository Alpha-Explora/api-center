import type { ServiceManifest, ServiceRegistryEntry } from "../../../types";
import { normalizeServiceEnvironments } from "./environment-resolver";

type CreateRegistryEntryOptions = {
  existing?: ServiceRegistryEntry | null;
  now: string;
  previousVersion?: string;
  /** Derived from the service's project by the registry; shared services have none. */
  ownerTribeId?: string;
};

export function createRegistryEntry(
  manifest: ServiceManifest,
  { existing, now, previousVersion, ownerTribeId }: CreateRegistryEntryOptions,
): ServiceRegistryEntry {
  const status = existing?.status === "deprecated" ? "deprecated" : "active";

  return {
    ...manifest,
    serviceType: manifest.serviceType || "tribe",
    ...(ownerTribeId ? { ownerTribeId } : {}),
    environments: normalizeServiceEnvironments(manifest, { status }),
    registeredAt: existing?.registeredAt || now,
    updatedAt: now,
    status,
    ...(previousVersion && { previousVersion }),
  };
}

export function normalizeRegistryEntry(
  entry: ServiceRegistryEntry,
): ServiceRegistryEntry {
  return {
    ...entry,
    environments: normalizeServiceEnvironments(entry, {
      status: entry.status,
    }),
  };
}
