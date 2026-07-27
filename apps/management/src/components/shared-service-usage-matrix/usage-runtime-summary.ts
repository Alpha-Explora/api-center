import type { SharedServiceRuntimeUsage } from "@/lib/schemas";
import { pairKey } from "@/components/shared-service-usage-matrix/usage-signals";

export function indexRuntimeUsage(records: SharedServiceRuntimeUsage[]) {
  return new Map(
    records.map((record) => [
      pairKey(record.tribeServiceId, record.sharedServiceId),
      record,
    ]),
  );
}

export function getRuntimeSummary(records: SharedServiceRuntimeUsage[]) {
  const totalRequests = records.reduce(
    (sum, record) => sum + record.totalRequests,
    0,
  );
  const failedRequests = records.reduce(
    (sum, record) => sum + record.failedRequests,
    0,
  );
  const latencyMsTotal = records.reduce(
    (sum, record) => sum + record.avgLatencyMs * record.totalRequests,
    0,
  );

  return {
    totalRequests,
    failedRequests,
    errorRate: totalRequests > 0 ? failedRequests / totalRequests : 0,
    avgLatencyMs:
      totalRequests > 0 ? Math.round(latencyMsTotal / totalRequests) : 0,
  };
}

export function sharedServiceLabel(serviceId: string) {
  if (serviceId === "payment") return "payment (PayMongo)";
  return serviceId;
}
