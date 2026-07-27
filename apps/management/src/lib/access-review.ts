import { expectedSharedServiceIds } from "@/lib/shared-service-usage";
import type {
  ServiceRegistryEntry,
  SharedServiceRuntimeUsage,
} from "@/lib/schemas";

export type AccessReviewEvidenceRow = {
  tribeServiceId: string;
  tribeName: string;
  ownerTeam: string;
  contact: string;
  sharedServiceId: string;
  scopes: string[];
  declared: boolean;
  registered: boolean;
  lastUsedAt?: string;
  deniedAttempts: number;
  unusedAccess: boolean;
};

export type AccessReviewEvidence = {
  generatedAt: string;
  window: string;
  rows: AccessReviewEvidenceRow[];
  summary: {
    tribeCount: number;
    accessGrantCount: number;
    unusedAccessCount: number;
    deniedAttemptCount: number;
  };
};

export function buildAccessReviewEvidence(input: {
  services: ServiceRegistryEntry[];
  runtimeUsage: SharedServiceRuntimeUsage[];
  window?: string;
  generatedAt?: string;
}): AccessReviewEvidence {
  const servicesById = new Map(
    input.services.map((service) => [service.serviceId, service]),
  );
  const runtimeByPair = new Map(
    input.runtimeUsage.map((record) => [
      pairKey(record.tribeServiceId, record.sharedServiceId),
      record,
    ]),
  );
  const tribes = input.services.filter(
    (service) => (service.serviceType ?? "tribe") === "tribe",
  );
  const rows = tribes.flatMap((tribe) =>
    tribe.consumes.map((sharedServiceId) => {
      const runtime = runtimeByPair.get(pairKey(tribe.serviceId, sharedServiceId));
      const registered =
        servicesById.has(sharedServiceId) ||
        expectedSharedServiceIds.includes(sharedServiceId);

      return {
        tribeServiceId: tribe.serviceId,
        tribeName: tribe.name,
        ownerTeam: tribe.ownerTeam || "Unassigned",
        contact: tribe.contact || "missing",
        sharedServiceId,
        scopes: tribe.requiredScopes.filter((scope) =>
          scope.includes(sharedServiceId),
        ),
        declared: true,
        registered,
        lastUsedAt: runtime?.lastUsedAt,
        deniedAttempts: runtime?.failedRequests ?? 0,
        unusedAccess: !runtime?.lastUsedAt,
      } satisfies AccessReviewEvidenceRow;
    }),
  );

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    window: input.window ?? "24h",
    rows,
    summary: {
      tribeCount: tribes.length,
      accessGrantCount: rows.length,
      unusedAccessCount: rows.filter((row) => row.unusedAccess).length,
      deniedAttemptCount: rows.reduce(
        (total, row) => total + row.deniedAttempts,
        0,
      ),
    },
  };
}

export function formatAccessReviewEvidenceExport(evidence: AccessReviewEvidence) {
  return JSON.stringify(evidence, null, 2);
}

function pairKey(tribeServiceId: string, sharedServiceId: string) {
  return `${tribeServiceId}::${sharedServiceId}`;
}
