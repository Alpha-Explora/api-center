"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EyeIcon, SearchIcon, ShieldAlertIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  getAuditEvents,
  getQuotaUsage,
  getSharedServiceRuntimeUsage,
  listServices,
} from "@/lib/api-center-client";
import type {
  AuditEvent,
  QuotaUsageDecision,
  ServiceRegistryEntry,
  SharedServiceRuntimeUsage,
} from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type ReliabilitySignal = {
  id: string;
  label: string;
  source: "Quotas" | "Shared services" | "Kafka" | "Proxy" | "Audit";
  severity: "critical" | "warning" | "info";
  evidence: string;
  action: {
    label: string;
    href: string;
  };
  priority: number;
};

export function TribeReliabilityPanel({
  initialTribeId = "",
}: {
  initialTribeId?: string;
}) {
  const [formTribeId, setFormTribeId] = useState(initialTribeId);
  const [tribeId, setTribeId] = useState(initialTribeId);
  const [selectedSignalId, setSelectedSignalId] = useState<string>();
  const enabled = Boolean(tribeId);
  const servicesQuery = useQuery({
    queryKey: ["reliability", "services"],
    queryFn: listServices,
  });
  const runtimeQuery = useQuery({
    queryKey: ["reliability", "runtime", tribeId],
    queryFn: () => getSharedServiceRuntimeUsage("24h"),
    enabled,
  });
  const quotaQuery = useQuery({
    queryKey: ["reliability", "quota", tribeId],
    queryFn: () => getQuotaUsage({ ownerTribeId: tribeId, window: "24h" }),
    enabled,
  });
  const auditQuery = useQuery({
    queryKey: ["reliability", "audit", tribeId],
    queryFn: () => getAuditEvents({ serviceId: tribeId, limit: 25 }),
    enabled,
  });
  const summary = useMemo(
    () =>
      buildReliabilitySummary({
        tribeId,
        services: servicesQuery.data ?? [],
        runtimeUsage: runtimeQuery.data ?? [],
        quotaUsage: quotaQuery.data ?? [],
        auditEvents: auditQuery.data ?? [],
      }),
    [
      auditQuery.data,
      quotaQuery.data,
      runtimeQuery.data,
      servicesQuery.data,
      tribeId,
    ],
  );
  const reliabilitySignals = useMemo(
    () => buildReliabilitySignals(summary),
    [summary],
  );
  const selectedSignal =
    reliabilitySignals.find((signal) => signal.id === selectedSignalId) ??
    reliabilitySignals[0];
  const isLoading =
    servicesQuery.isLoading ||
    (enabled &&
      (runtimeQuery.isLoading || quotaQuery.isLoading || auditQuery.isLoading));

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTribeId(formTribeId.trim());
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tribe reliability</CardTitle>
        <CardDescription>
          Proxy success, latency, quota decisions, Kafka failures, and affected
          services for one tribe.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={submit}>
          <Field className="max-w-sm">
            <FieldLabel htmlFor="reliability-tribe-id">Tribe ID</FieldLabel>
            <Input
              id="reliability-tribe-id"
              value={formTribeId}
              onChange={(event) => setFormTribeId(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" className="self-end">
            <SearchIcon data-icon="inline-start" />
            Inspect tribe
          </Button>
        </form>

        {isLoading ? (
          <Skeleton className="h-72 rounded-xl" />
        ) : (
          <>
            <ReliabilityReview
              signals={reliabilitySignals}
              selectedSignal={selectedSignal}
              onSelectSignal={setSelectedSignalId}
            />
            <div className="grid gap-4 lg:grid-cols-4">
              <Metric label="Tribe" value={summary.tribeId || "Not selected"} />
              <Metric label="Proxy success rate" value={summary.successRate} />
              <Metric
                label="P95 latency"
                value={`${summary.p95LatencyMs} ms`}
              />
              <Metric
                label="Failed shared calls"
                value={String(summary.failedCalls)}
              />
              <Metric
                label="Quota decisions"
                value={`${summary.observedQuota} observed / ${summary.blockedQuota} blocked`}
              />
              <Metric label="Kafka failures" value={summary.kafkaFailureLabel} />
              <Metric
                label="Affected services"
                value={summary.affectedServices.join(", ") || "None"}
              />
              <Metric
                label="Recent changes"
                value={summary.recentChanges[0]?.message ?? "No recent changes"}
              />
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {summary.affectedServices.map((serviceId) => (
            <Badge key={serviceId} variant="outline">
              {serviceId}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ReliabilityReview({
  signals,
  selectedSignal,
  onSelectSignal,
}: {
  signals: ReliabilitySignal[];
  selectedSignal?: ReliabilitySignal;
  onSelectSignal: (signalId: string) => void;
}) {
  if (!signals.length) {
    return (
      <section className="rounded-lg border bg-muted/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldAlertIcon data-icon="inline-start" />
          Reliability review
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          No reliability signals need review for this tribe.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.8fr)]">
      <div className="overflow-hidden rounded-lg border">
        <div className="hidden grid-cols-[minmax(11rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Signal</span>
          <span>Severity</span>
          <span>Evidence</span>
          <span className="sr-only">Inspect</span>
        </div>
        <div className="divide-y">
          {signals.map((signal) => (
            <ReliabilitySignalRow
              key={signal.id}
              signal={signal}
              selected={signal.id === selectedSignal?.id}
              onSelect={() => onSelectSignal(signal.id)}
            />
          ))}
        </div>
      </div>
      {selectedSignal ? (
        <ReliabilitySignalDetail signal={selectedSignal} />
      ) : null}
    </section>
  );
}

function ReliabilitySignalRow({
  signal,
  selected,
  onSelect,
}: {
  signal: ReliabilitySignal;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 md:grid-cols-[minmax(11rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] md:items-start">
      <div className="min-w-0">
        <div className="truncate font-medium">{signal.label}</div>
        <div className="truncate text-xs text-muted-foreground">
          {signal.source}
        </div>
      </div>
      <div className="col-start-1 md:col-auto">
        <Badge variant={signal.severity === "info" ? "secondary" : "destructive"}>
          {signal.severity}
        </Badge>
      </div>
      <div className="col-start-1 min-w-0 break-words text-sm text-muted-foreground md:col-auto">
        {signal.evidence}
      </div>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect reliability signal ${signal.label}`}
        title={`Inspect reliability signal ${signal.label}`}
        onClick={onSelect}
        className="col-start-2 row-start-1 inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground md:col-auto md:row-auto"
      >
        <EyeIcon data-icon="inline-end" />
      </button>
    </div>
  );
}

function ReliabilitySignalDetail({ signal }: { signal: ReliabilitySignal }) {
  return (
    <aside
      aria-label="Selected reliability signal detail"
      className="order-first rounded-lg border bg-muted/10 p-4 xl:order-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            Selected reliability signal
          </div>
          <div className="mt-1 truncate text-base font-medium">
            {signal.label}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {signal.source}
          </div>
        </div>
        <Badge variant={signal.severity === "info" ? "secondary" : "destructive"}>
          {signal.severity}
        </Badge>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">Evidence</div>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {signal.evidence}
        </p>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">
          Next action
        </div>
        <Link
          href={signal.action.href}
          className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          {signal.action.label}
          <ShieldAlertIcon data-icon="inline-end" />
        </Link>
      </div>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-lg font-semibold">{value}</div>
    </div>
  );
}

function buildReliabilitySummary(input: {
  tribeId: string;
  services: ServiceRegistryEntry[];
  runtimeUsage: SharedServiceRuntimeUsage[];
  quotaUsage: QuotaUsageDecision[];
  auditEvents: AuditEvent[];
}) {
  const runtime = input.runtimeUsage.filter(
    (row) => row.tribeServiceId === input.tribeId,
  );
  const total = runtime.reduce((sum, row) => sum + row.totalRequests, 0);
  const success = runtime.reduce((sum, row) => sum + row.successRequests, 0);
  const failedCalls = runtime.reduce((sum, row) => sum + row.failedRequests, 0);
  const p95LatencyMs = Math.max(
    0,
    ...runtime.map((row) => row.p95LatencyMs ?? 0),
  );
  const observedQuota = input.quotaUsage.filter(
    (row) => row.outcome === "observed_exceeded",
  ).length;
  const blockedQuota = input.quotaUsage.filter(
    (row) => row.outcome === "blocked",
  ).length;
  const kafkaFailures = input.auditEvents.filter((event) =>
    event.type.toLowerCase().includes("kafka"),
  ).length;
  const owned = input.services.filter(
    (service) => (service.ownerTribeId ?? service.serviceId) === input.tribeId,
  );
  const declared = owned.flatMap((service) => service.consumes ?? []);
  const affectedServices = [
    ...new Set([...declared, ...runtime.map((row) => row.sharedServiceId)]),
  ];

  return {
    tribeId: input.tribeId,
    successRate: total ? `${Math.round((success / total) * 100)}%` : "0%",
    p95LatencyMs,
    failedCalls,
    observedQuota,
    blockedQuota,
    kafkaFailures,
    kafkaFailureLabel: `${kafkaFailures} Kafka failure${kafkaFailures === 1 ? "" : "s"}`,
    affectedServices,
    recentChanges: input.auditEvents.filter((event) =>
      /deploy|config|policy|registered|retired/i.test(event.type),
    ),
  };
}

function buildReliabilitySignals(
  summary: ReturnType<typeof buildReliabilitySummary>,
) {
  const signals: ReliabilitySignal[] = [];

  if (summary.blockedQuota > 0) {
    signals.push({
      id: "quota:blocked",
      label: "Quota blocked",
      source: "Quotas",
      severity: "critical",
      evidence: `${summary.blockedQuota} quota decision${summary.blockedQuota === 1 ? "" : "s"} blocked.`,
      action: {
        label: "Review quota decisions",
        href: serviceDetailHref(summary.tribeId, "quotas"),
      },
      priority: 0,
    });
  }

  if (summary.failedCalls > 0) {
    signals.push({
      id: "shared-services:failed-calls",
      label: "Shared-service failures",
      source: "Shared services",
      severity: "critical",
      evidence: `${summary.failedCalls} shared-service call${summary.failedCalls === 1 ? "" : "s"} failed in the last 24h.`,
      action: {
        label: "Review shared-service usage",
        href: serviceDetailHref(summary.tribeId, "dependencies"),
      },
      priority: 1,
    });
  }

  if (summary.kafkaFailures > 0) {
    signals.push({
      id: "kafka:failures",
      label: "Kafka publish failures",
      source: "Kafka",
      severity: "critical",
      evidence: `${summary.kafkaFailures} Kafka publish failure${summary.kafkaFailures === 1 ? "" : "s"} found in audit events.`,
      action: {
        label: "Review data pipeline",
        href: serviceDetailHref(summary.tribeId, "pipeline"),
      },
      priority: 2,
    });
  }

  if (summary.p95LatencyMs >= 500) {
    signals.push({
      id: "proxy:high-latency",
      label: "High proxy latency",
      source: "Proxy",
      severity: "warning",
      evidence: `P95 latency is ${summary.p95LatencyMs} ms in the last 24h.`,
      action: {
        label: "Review shared-service usage",
        href: serviceDetailHref(summary.tribeId, "dependencies"),
      },
      priority: 3,
    });
  }

  if (summary.observedQuota > 0) {
    signals.push({
      id: "quota:observed",
      label: "Quota observed overage",
      source: "Quotas",
      severity: "warning",
      evidence: `${summary.observedQuota} quota decision${summary.observedQuota === 1 ? "" : "s"} exceeded the observe threshold.`,
      action: {
        label: "Review quota decisions",
        href: serviceDetailHref(summary.tribeId, "quotas"),
      },
      priority: 4,
    });
  }

  if (summary.recentChanges[0]) {
    signals.push({
      id: `audit:${summary.recentChanges[0].id}`,
      label: "Recent change",
      source: "Audit",
      severity: "info",
      evidence: summary.recentChanges[0].message,
      action: {
        label: "Review audit events",
        href: serviceDetailHref(summary.tribeId, "evidence"),
      },
      priority: 5,
    });
  }

  return signals.sort(compareReliabilitySignals);
}

function compareReliabilitySignals(
  left: ReliabilitySignal,
  right: ReliabilitySignal,
) {
  const severityDelta = reliabilitySeverityRank(left) - reliabilitySeverityRank(right);
  if (severityDelta !== 0) return severityDelta;
  const priorityDelta = left.priority - right.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return left.id.localeCompare(right.id);
}

function reliabilitySeverityRank(signal: ReliabilitySignal) {
  if (signal.severity === "critical") return 0;
  if (signal.severity === "warning") return 1;
  return 2;
}

function serviceDetailHref(serviceId: string, section: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=${section}`;
}
