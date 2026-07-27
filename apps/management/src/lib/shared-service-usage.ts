import { sharedServiceManifests } from "@/lib/shared-service-manifests";
import type { ServiceRegistryEntry } from "@/lib/schemas";

export const expectedSharedServiceIds = sharedServiceManifests.map(
  (manifest) => manifest.serviceId,
);

export type SharedServiceUsageCell = {
  sharedServiceId: string;
  declared: boolean;
  registered: boolean;
};

export type TribeSharedServiceUsageRow = {
  tribe: ServiceRegistryEntry;
  cells: SharedServiceUsageCell[];
  declaredCount: number;
  missingCount: number;
};

export type SharedServiceUsageSummary = {
  tribeCount: number;
  declaredLinkCount: number;
  missingRegistrationCount: number;
  mostConsumedSharedService: string | null;
};

export function getDeclaredSharedServiceUsage(
  services: ServiceRegistryEntry[],
) {
  const tribes = services
    .filter((service) => (service.serviceType ?? "tribe") === "tribe")
    .sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  const registeredIds = new Set(services.map((service) => service.serviceId));
  const declaredCounts = new Map<string, number>();

  const rows: TribeSharedServiceUsageRow[] = tribes.map((tribe) => {
    const consumedIds = new Set(tribe.consumes);
    const cells = expectedSharedServiceIds.map((sharedServiceId) => {
      const declared = consumedIds.has(sharedServiceId);

      if (declared) {
        declaredCounts.set(
          sharedServiceId,
          (declaredCounts.get(sharedServiceId) ?? 0) + 1,
        );
      }

      return {
        sharedServiceId,
        declared,
        registered: registeredIds.has(sharedServiceId),
      };
    });

    return {
      tribe,
      cells,
      declaredCount: cells.filter((cell) => cell.declared).length,
      missingCount: cells.filter((cell) => cell.declared && !cell.registered)
        .length,
    };
  });

  const mostConsumedSharedService =
    [...declaredCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const summary: SharedServiceUsageSummary = {
    tribeCount: tribes.length,
    declaredLinkCount: rows.reduce((total, row) => total + row.declaredCount, 0),
    missingRegistrationCount: rows.reduce(
      (total, row) => total + row.missingCount,
      0,
    ),
    mostConsumedSharedService,
  };

  return {
    rows,
    summary,
    expectedSharedServiceIds,
  };
}
