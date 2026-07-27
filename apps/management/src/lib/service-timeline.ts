import type {
  AuditEvent,
  ServiceRegistryEntry,
  SharedServiceRuntimeUsage,
} from "@/lib/schemas";

export type TimelineSource = "audit" | "alert" | "smoke" | "usage" | "readiness" | "secret";
export type TimelineSeverity = "info" | "warning" | "error" | "success";

export type ServiceTimelineEvent = {
  id: string;
  occurredAt: string;
  source: TimelineSource;
  title: string;
  detail?: string;
  severity: TimelineSeverity;
  metadata?: Record<string, string | number | boolean | null>;
};

export function mergeTimelineEvents(events: ServiceTimelineEvent[]) {
  return [...events].sort(
    (left, right) =>
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
  );
}

export type IncidentSnapshot = {
  readiness: string;
  recentFailures: number;
  lastWrite: string;
  providerChecks: number;
};

export function buildServiceTimelineEvents({
  service,
  auditEvents,
  runtimeUsage,
}: {
  service: ServiceRegistryEntry;
  auditEvents: AuditEvent[];
  runtimeUsage: SharedServiceRuntimeUsage[];
}) {
  const events: ServiceTimelineEvent[] = [
    {
      id: `registry-${service.serviceId}-${service.updatedAt}`,
      occurredAt: service.updatedAt,
      source: "readiness",
      title: `Registry status: ${service.status}`,
      detail: `${service.name} was last updated in the registry.`,
      severity: service.status === "active" ? "success" : "warning",
      metadata: {
        result: service.status === "active" ? "success" : "warning",
        environment: "registry",
      },
    },
  ];

  for (const event of auditEvents.filter((event) =>
    auditEventBelongsToService(event, service.serviceId),
  )) {
    events.push({
      id: `audit-${event.id}`,
      occurredAt: event.timestamp,
      source: "audit",
      title: event.message,
      detail: event.type,
      severity: event.severity === "error" ? "error" : event.severity,
      metadata: compactMetadata({
        actor: getAuditActor(event),
        environment: getAuditEnvironment(event),
        result: event.severity === "error" ? "failure" : "success",
      }),
    });
  }

  for (const usage of runtimeUsage.filter((usage) =>
    runtimeUsageBelongsToService(usage, service),
  )) {
    if (!usage.lastUsedAt) continue;
    const title =
      service.serviceType === "shared"
        ? `${usage.tribeServiceId} called ${service.serviceId}`
        : `${service.serviceId} called ${usage.sharedServiceId}`;

    events.push({
      id: `usage-${usage.tribeServiceId}-${usage.sharedServiceId}-${usage.lastUsedAt}`,
      occurredAt: usage.lastUsedAt,
      source: "usage",
      title,
      detail: `${usage.totalRequests} calls, ${usage.failedRequests} failed, ${usage.avgLatencyMs}ms average latency.`,
      severity: usage.failedRequests > 0 ? "error" : "success",
      metadata: {
        result: usage.failedRequests > 0 ? "failure" : "success",
        environment: "runtime",
      },
    });
  }

  return mergeTimelineEvents(events);
}

export function buildIncidentSnapshot(events: ServiceTimelineEvent[]) {
  const failures = events.filter((event) => event.severity === "error");
  const writeEvents = events.filter((event) =>
    String(event.detail ?? event.title).toLowerCase().match(/write|create|update|delete|rotate|provision|restart/),
  );
  const providerChecks = events.filter((event) =>
    String(event.detail ?? event.title).toLowerCase().match(/provider|payment|sms|email|otp|geo|gauth/),
  );

  return {
    readiness: failures.length ? "attention needed" : "no recent failures",
    recentFailures: failures.length,
    lastWrite: writeEvents[0]?.occurredAt ?? "none in loaded window",
    providerChecks: providerChecks.length,
  } satisfies IncidentSnapshot;
}

function auditEventBelongsToService(event: AuditEvent, serviceId: string) {
  return (
    event.serviceId === serviceId ||
    event.tribeServiceId === serviceId ||
    event.sharedServiceId === serviceId
  );
}

function runtimeUsageBelongsToService(
  usage: SharedServiceRuntimeUsage,
  service: ServiceRegistryEntry,
) {
  if (service.serviceType === "shared") {
    return usage.sharedServiceId === service.serviceId;
  }
  return usage.tribeServiceId === service.serviceId;
}

function getAuditActor(event: AuditEvent) {
  return stringPayloadValue(event.payload, [
    "actor",
    "operatorEmail",
    "email",
    "userId",
  ]);
}

function getAuditEnvironment(event: AuditEvent) {
  return stringPayloadValue(event.payload, ["environment", "managementEnvironment"]);
}

function stringPayloadValue(
  payload: AuditEvent["payload"],
  keys: string[],
) {
  if (!payload) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function compactMetadata(
  metadata: Record<string, string | number | boolean | null | undefined>,
) {
  return Object.fromEntries(
    Object.entries(metadata).filter((entry) => entry[1] !== undefined),
  ) as Record<string, string | number | boolean | null>;
}
