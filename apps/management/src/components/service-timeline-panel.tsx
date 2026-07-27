"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  buildIncidentSnapshot,
  buildServiceTimelineEvents,
  type ServiceTimelineEvent,
  type TimelineSeverity,
  type TimelineSource,
} from "@/lib/service-timeline";
import {
  getAuditEvents,
  getSharedServiceRuntimeUsage,
} from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import type { ServiceRegistryEntry } from "@/lib/schemas";
import { ServiceTimeline } from "@/components/service-timeline";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type SourceFilter = "all" | TimelineSource;
type SeverityFilter = "all" | TimelineSeverity;
type ResultFilter = "all" | "success" | "failure";
type EnvironmentFilter = "all" | "registry" | "runtime" | "test" | "live";

export function ServiceTimelinePanel({
  service,
}: {
  service: ServiceRegistryEntry;
}) {
  const [source, setSource] = useState<SourceFilter>("all");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [result, setResult] = useState<ResultFilter>("all");
  const [environment, setEnvironment] = useState<EnvironmentFilter>("all");
  const [actor, setActor] = useState("");

  const auditQuery = useQuery({
    queryKey: queryKeys.auditEvents(`service:${service.serviceId}`),
    queryFn: () => getAuditEvents({ serviceId: service.serviceId, limit: 50 }),
    retry: 1,
  });
  const usageQuery = useQuery({
    queryKey: queryKeys.sharedServiceUsage("24h"),
    queryFn: () => getSharedServiceRuntimeUsage("24h"),
    retry: 1,
  });

  const events = useMemo(
    () =>
      buildServiceTimelineEvents({
        service,
        auditEvents: auditQuery.data ?? [],
        runtimeUsage: usageQuery.data ?? [],
      }),
    [auditQuery.data, service, usageQuery.data],
  );
  const filteredEvents = events.filter((event) =>
    matchesTimelineFilters(event, {
      source,
      severity,
      result,
      environment,
      actor,
    }),
  );
  const snapshot = buildIncidentSnapshot(events);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service timeline</CardTitle>
        <CardDescription>
          Recent registry, audit, usage, and readiness signals for this service.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <SnapshotItem label="Current readiness" value={snapshot.readiness} />
          <SnapshotItem
            label="Recent failures"
            value={String(snapshot.recentFailures)}
          />
          <SnapshotItem label="Last write" value={snapshot.lastWrite} />
          <SnapshotItem
            label="Provider checks"
            value={String(snapshot.providerChecks)}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-5">
          <TimelineSelect
            label="Action type"
            value={source}
            onChange={(value) => setSource(value as SourceFilter)}
            options={["all", "audit", "usage", "readiness", "alert", "smoke", "secret"]}
          />
          <TimelineSelect
            label="Success/failure"
            value={result}
            onChange={(value) => setResult(value as ResultFilter)}
            options={["all", "success", "failure"]}
          />
          <TimelineSelect
            label="Severity"
            value={severity}
            onChange={(value) => setSeverity(value as SeverityFilter)}
            options={["all", "success", "info", "warning", "error"]}
          />
          <TimelineSelect
            label="Environment"
            value={environment}
            onChange={(value) => setEnvironment(value as EnvironmentFilter)}
            options={["all", "registry", "runtime", "test", "live"]}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Actor</span>
            <Input
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              placeholder="email or user id"
            />
          </label>
        </div>

        {auditQuery.isError || usageQuery.isError ? (
          <Alert>
            <AlertTitle>Timeline data is partial</AlertTitle>
            <AlertDescription>
              Some audit or runtime analytics endpoints are unavailable. Registry
              and loaded signals are still shown.
            </AlertDescription>
          </Alert>
        ) : null}

        <ServiceTimeline events={filteredEvents} />
      </CardContent>
    </Card>
  );
}

function matchesTimelineFilters(
  event: ServiceTimelineEvent,
  filters: {
    source: SourceFilter;
    severity: SeverityFilter;
    result: ResultFilter;
    environment: EnvironmentFilter;
    actor: string;
  },
) {
  if (filters.source !== "all" && event.source !== filters.source) return false;
  if (filters.severity !== "all" && event.severity !== filters.severity) {
    return false;
  }
  if (
    filters.result !== "all" &&
    event.metadata?.result !== filters.result
  ) {
    return false;
  }
  if (
    filters.environment !== "all" &&
    event.metadata?.environment !== filters.environment
  ) {
    return false;
  }
  const actorFilter = filters.actor.trim().toLowerCase();
  if (actorFilter) {
    const actor = String(event.metadata?.actor ?? "").toLowerCase();
    if (!actor.includes(actorFilter)) return false;
  }
  return true;
}

function SnapshotItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/25 p-3 text-sm">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 break-all font-mono">{value}</div>
    </div>
  );
}

function TimelineSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <select
        className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
