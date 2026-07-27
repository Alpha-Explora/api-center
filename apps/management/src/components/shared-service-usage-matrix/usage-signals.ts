import type { getDeclaredSharedServiceUsage } from "@/lib/shared-service-usage";
import type { SharedServiceRuntimeUsage } from "@/lib/schemas";

const HIGH_ERROR_RATE = 0.05;
const HIGH_LATENCY_MS = 500;

export type UsageReviewSignal = {
  key: string;
  tribeServiceId: string;
  tribeName: string;
  sharedServiceId: string;
  declared: boolean;
  registered: boolean;
  runtime?: SharedServiceRuntimeUsage;
};

export function getUsageReviewSignals(
  rows: ReturnType<typeof getDeclaredSharedServiceUsage>["rows"],
  runtimeUsage: SharedServiceRuntimeUsage[],
  registeredServiceIds: Set<string>,
): UsageReviewSignal[] {
  const runtimeByPair = indexRuntimeUsage(runtimeUsage);
  const rowByTribeId = new Map(
    rows.map((row) => [row.tribe.serviceId, row] as const),
  );
  const signalByKey = new Map<string, UsageReviewSignal>();

  for (const row of rows) {
    for (const cell of row.cells) {
      const runtime = runtimeByPair.get(
        pairKey(row.tribe.serviceId, cell.sharedServiceId),
      );

      if (!shouldIncludeUsageSignal(cell, runtime)) continue;

      const signal: UsageReviewSignal = {
        key: pairKey(row.tribe.serviceId, cell.sharedServiceId),
        tribeServiceId: row.tribe.serviceId,
        tribeName: row.tribe.name,
        sharedServiceId: cell.sharedServiceId,
        declared: cell.declared,
        registered: cell.registered,
        runtime,
      };
      signalByKey.set(signal.key, signal);
    }
  }

  for (const runtime of runtimeUsage) {
    const key = pairKey(runtime.tribeServiceId, runtime.sharedServiceId);
    if (signalByKey.has(key)) continue;

    const row = rowByTribeId.get(runtime.tribeServiceId);
    if (!row) continue;

    signalByKey.set(key, {
      key,
      tribeServiceId: runtime.tribeServiceId,
      tribeName: row.tribe.name,
      sharedServiceId: runtime.sharedServiceId,
      declared: row.tribe.consumes.includes(runtime.sharedServiceId),
      registered: registeredServiceIds.has(runtime.sharedServiceId),
      runtime,
    });
  }

  return [...signalByKey.values()].sort(compareUsageSignals);
}

export function shouldIncludeUsageSignal(
  cell: { declared: boolean; registered: boolean },
  runtime?: SharedServiceRuntimeUsage,
) {
  const hasRuntime = (runtime?.totalRequests ?? 0) > 0;
  return (
    hasRuntime ||
    (cell.declared && !cell.registered) ||
    (runtime?.errorRate ?? 0) >= HIGH_ERROR_RATE ||
    (runtime?.avgLatencyMs ?? 0) >= HIGH_LATENCY_MS
  );
}

export function compareUsageSignals(
  left: UsageReviewSignal,
  right: UsageReviewSignal,
) {
  const rankDelta = usageSignalRank(left) - usageSignalRank(right);
  if (rankDelta !== 0) return rankDelta;

  const leftRequests = left.runtime?.totalRequests ?? 0;
  const rightRequests = right.runtime?.totalRequests ?? 0;
  if (leftRequests !== rightRequests) return rightRequests - leftRequests;

  return left.key.localeCompare(right.key);
}

export function usageSignalRank(signal: UsageReviewSignal) {
  const hasRuntime = (signal.runtime?.totalRequests ?? 0) > 0;
  if (hasRuntime && !signal.declared) return 0;
  if (signal.declared && !signal.registered) return 1;
  if ((signal.runtime?.errorRate ?? 0) >= HIGH_ERROR_RATE) return 2;
  if ((signal.runtime?.avgLatencyMs ?? 0) >= HIGH_LATENCY_MS) return 3;
  if (hasRuntime) return 4;
  return 5;
}

export function usageSignalStatus(signal: UsageReviewSignal) {
  if ((signal.runtime?.totalRequests ?? 0) > 0 && !signal.declared) {
    return { label: "undeclared", variant: "destructive" as const };
  }
  if (signal.declared && !signal.registered) {
    return { label: "missing", variant: "destructive" as const };
  }
  if ((signal.runtime?.errorRate ?? 0) >= HIGH_ERROR_RATE) {
    return { label: "errors", variant: "destructive" as const };
  }
  if ((signal.runtime?.avgLatencyMs ?? 0) >= HIGH_LATENCY_MS) {
    return { label: "latency", variant: "outline" as const };
  }
  if ((signal.runtime?.totalRequests ?? 0) > 0) {
    return { label: "active", variant: "secondary" as const };
  }
  return { label: "declared", variant: "outline" as const };
}

export function usageSignalEvidence(signal: UsageReviewSignal) {
  if ((signal.runtime?.totalRequests ?? 0) > 0 && !signal.declared) {
    return "Runtime calls exist, but this shared service is not declared in the tribe manifest.";
  }
  if (signal.declared && !signal.registered) {
    return `${signal.sharedServiceId} is declared but not registered as a shared service.`;
  }
  if ((signal.runtime?.errorRate ?? 0) >= HIGH_ERROR_RATE) {
    return `${(signal.runtime!.errorRate * 100).toFixed(1)}% error rate across ${signal.runtime!.totalRequests} runtime calls.`;
  }
  if ((signal.runtime?.avgLatencyMs ?? 0) >= HIGH_LATENCY_MS) {
    return `${signal.runtime!.avgLatencyMs}ms average latency across ${signal.runtime!.totalRequests} runtime calls.`;
  }
  if ((signal.runtime?.totalRequests ?? 0) > 0) {
    return `${signal.runtime!.totalRequests} runtime calls with ${(signal.runtime!.errorRate * 100).toFixed(1)}% errors.`;
  }
  return "Declared in the tribe manifest with no runtime calls in the selected window.";
}

export function usageSignalAction(signal: UsageReviewSignal) {
  if ((signal.runtime?.totalRequests ?? 0) > 0 && !signal.declared) {
    return {
      label: "Update the tribe manifest.",
      href: `/tribes/${signal.tribeServiceId}/edit`,
    };
  }
  if (signal.declared && !signal.registered) {
    return {
      label: "Open shared-service setup.",
      href: "/shared-services/setup",
    };
  }
  if (
    (signal.runtime?.errorRate ?? 0) >= HIGH_ERROR_RATE ||
    (signal.runtime?.avgLatencyMs ?? 0) >= HIGH_LATENCY_MS
  ) {
    return {
      label: "Review quotas for this tribe.",
      href: serviceDetailHref(signal.tribeServiceId, "quotas"),
    };
  }
  return {
    label: "Open the tribe service record.",
    href: serviceDependencyHref(signal.tribeServiceId),
  };
}

export function serviceDependencyHref(serviceId: string) {
  return serviceDetailHref(serviceId, "dependencies");
}

export function serviceDetailHref(serviceId: string, section: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=${encodeURIComponent(section)}`;
}

export function pairKey(tribeServiceId: string, sharedServiceId: string) {
  return `${tribeServiceId}::${sharedServiceId}`;
}

function indexRuntimeUsage(records: SharedServiceRuntimeUsage[]) {
  return new Map(
    records.map((record) => [
      pairKey(record.tribeServiceId, record.sharedServiceId),
      record,
    ]),
  );
}
