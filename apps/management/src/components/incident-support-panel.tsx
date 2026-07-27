"use client";

import Link from "next/link";
import { EyeIcon, SearchIcon, ShieldAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getAuditEvents,
  getProviderUsage,
  getSharedServiceRuntimeUsage,
  listQuotaPolicies,
  listServices,
} from "@/lib/api-center-client";
import type {
  AuditEvent,
  ProviderUsage,
  QuotaPolicy,
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

type IncidentAction = {
  id: string;
  label: string;
  source: "Provider" | "Runtime" | "Quotas" | "Audit";
  severity: "critical" | "warning" | "info";
  evidence: string;
  action: {
    label: string;
    href: string;
  };
  priority: number;
};

export function IncidentSupportPanel({
  initialTarget = "",
}: {
  initialTarget?: string;
}) {
  const [formTarget, setFormTarget] = useState(initialTarget);
  const [target, setTarget] = useState(initialTarget);
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const enabled = Boolean(target);
  const servicesQuery = useQuery({
    queryKey: ["incident", "services"],
    queryFn: listServices,
  });
  const runtimeQuery = useQuery({
    queryKey: ["incident", "runtime", target],
    queryFn: () => getSharedServiceRuntimeUsage("24h"),
    enabled,
  });
  const auditQuery = useQuery({
    queryKey: ["incident", "audit", target],
    queryFn: () => getAuditEvents({ serviceId: target, limit: 50 }),
    enabled,
  });
  const quotaQuery = useQuery({
    queryKey: ["incident", "quotas", target],
    queryFn: () => listQuotaPolicies(),
    enabled,
  });
  const providerQuery = useQuery({
    queryKey: ["incident", "providers", target],
    queryFn: () => getProviderUsage("24h"),
    enabled,
  });
  const summary = useMemo(
    () =>
      buildIncidentSummary({
        target,
        services: servicesQuery.data ?? [],
        runtimeUsage: runtimeQuery.data ?? [],
        auditEvents: auditQuery.data ?? [],
        quotaPolicies: quotaQuery.data ?? [],
        providerUsage: providerQuery.data ?? [],
      }),
    [
      auditQuery.data,
      providerQuery.data,
      quotaQuery.data,
      runtimeQuery.data,
      servicesQuery.data,
      target,
    ],
  );
  const incidentActions = useMemo(
    () => buildIncidentActions(summary),
    [summary],
  );
  const selectedAction =
    incidentActions.find((action) => action.id === selectedActionId) ??
    incidentActions[0];
  const isLoading =
    enabled &&
    (servicesQuery.isLoading ||
      runtimeQuery.isLoading ||
      auditQuery.isLoading ||
      quotaQuery.isLoading ||
      providerQuery.isLoading);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTarget(formTarget.trim());
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Incident support</CardTitle>
        <CardDescription>
          Inspect failures, audit changes, active quotas, provider status, and
          runbooks for a service or tribe.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={submit}>
          <Field className="max-w-sm">
            <FieldLabel htmlFor="incident-target">Service or tribe</FieldLabel>
            <Input
              id="incident-target"
              value={formTarget}
              onChange={(event) => setFormTarget(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" className="self-end">
            <SearchIcon data-icon="inline-start" />
            Inspect incident
          </Button>
        </form>

        {isLoading ? (
          <Skeleton className="h-72 rounded-xl" />
        ) : (
          <>
            <IncidentActionReview
              actions={incidentActions}
              selectedAction={selectedAction}
              onSelectAction={setSelectedActionId}
            />
            <div className="grid gap-4 lg:grid-cols-3">
              <Metric label="Target" value={summary.target || "Not selected"} />
              <Metric
                label="Recent failures"
                value={`${summary.failedCalls} failed calls`}
              />
              <Metric
                label="Provider status"
                value={`${summary.providerErrorRate}% provider error rate`}
              />
              <Metric
                label="Active quotas"
                value={summary.activeQuotaLabels.join(", ") || "None"}
              />
              <Metric
                label="Recent policy changes"
                value={summary.policyEvents[0]?.message ?? "No policy changes"}
              />
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Runbooks</div>
                <Link
                  href="/docs/operations/apicenter-management-runbook"
                  className="mt-2 inline-flex rounded-full border px-3 py-1 text-sm font-medium hover:bg-muted"
                >
                  Open incident runbook
                </Link>
              </div>
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {summary.relatedServices.map((serviceId) => (
            <Badge key={serviceId} variant="outline">
              {serviceId}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function IncidentActionReview({
  actions,
  selectedAction,
  onSelectAction,
}: {
  actions: IncidentAction[];
  selectedAction?: IncidentAction;
  onSelectAction: (actionId: string) => void;
}) {
  if (!actions.length) {
    return (
      <section className="rounded-lg border bg-muted/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldAlertIcon data-icon="inline-start" />
          Incident action review
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          No incident actions need review for this target.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.8fr)]">
      <div className="overflow-hidden rounded-lg border">
        <div className="hidden grid-cols-[minmax(11rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Action</span>
          <span>Severity</span>
          <span>Evidence</span>
          <span className="sr-only">Inspect</span>
        </div>
        <div className="divide-y">
          {actions.map((action) => (
            <IncidentActionRow
              key={action.id}
              action={action}
              selected={action.id === selectedAction?.id}
              onSelect={() => onSelectAction(action.id)}
            />
          ))}
        </div>
      </div>
      {selectedAction ? <IncidentActionDetail action={selectedAction} /> : null}
    </section>
  );
}

function IncidentActionRow({
  action,
  selected,
  onSelect,
}: {
  action: IncidentAction;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 md:grid-cols-[minmax(11rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] md:items-start">
      <div className="min-w-0">
        <div className="truncate font-medium">{action.label}</div>
        <div className="truncate text-xs text-muted-foreground">
          {action.source}
        </div>
      </div>
      <div className="col-start-1 md:col-auto">
        <Badge variant={action.severity === "info" ? "secondary" : "destructive"}>
          {action.severity}
        </Badge>
      </div>
      <div className="col-start-1 min-w-0 break-words text-sm text-muted-foreground md:col-auto">
        {action.evidence}
      </div>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect incident action ${action.label}`}
        title={`Inspect incident action ${action.label}`}
        onClick={onSelect}
        className="col-start-2 row-start-1 inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground md:col-auto md:row-auto"
      >
        <EyeIcon data-icon="inline-end" />
      </button>
    </div>
  );
}

function IncidentActionDetail({ action }: { action: IncidentAction }) {
  return (
    <aside
      aria-label="Selected incident action detail"
      className="order-first rounded-lg border bg-muted/10 p-4 xl:order-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Selected incident action</div>
          <div className="mt-1 truncate text-base font-medium">
            {action.label}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {action.source}
          </div>
        </div>
        <Badge variant={action.severity === "info" ? "secondary" : "destructive"}>
          {action.severity}
        </Badge>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">Evidence</div>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {action.evidence}
        </p>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">
          Next action
        </div>
        <Link
          href={action.action.href}
          className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          {action.action.label}
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

function buildIncidentSummary(input: {
  target: string;
  services: ServiceRegistryEntry[];
  runtimeUsage: SharedServiceRuntimeUsage[];
  auditEvents: AuditEvent[];
  quotaPolicies: QuotaPolicy[];
  providerUsage: ProviderUsage[];
}) {
  const relatedRuntime = input.runtimeUsage.filter(
    (row) =>
      row.sharedServiceId === input.target ||
      row.tribeServiceId === input.target,
  );
  const failedCalls = relatedRuntime.reduce(
    (sum, row) => sum + row.failedRequests,
    0,
  );
  const activeQuotas = input.quotaPolicies.filter(
    (policy) =>
      policy.status === "active" &&
      (policy.ownerTribeId === input.target ||
        policy.targetServiceId === input.target),
  );
  const policyEvents = input.auditEvents.filter((event) =>
    event.type.toLowerCase().includes("policy"),
  );
  const provider = input.providerUsage.find(
    (row) => row.provider === input.target,
  );
  const providerErrorRate = Math.round(Number(provider?.errorRate ?? 0) * 100);
  const providerFailedRequests = Number(provider?.failedRequests ?? 0);
  const relatedServices = [
    ...new Set([
      ...relatedRuntime.map((row) => row.tribeServiceId),
      ...relatedRuntime.map((row) => row.sharedServiceId),
      ...input.services
        .filter((service) => service.serviceId === input.target)
        .flatMap((service) => service.consumes ?? []),
    ]),
  ].filter(Boolean);

  return {
    target: input.target,
    failedCalls,
    activeQuotaLabels: activeQuotas.map(
      (policy) => `${policy.mode} ${policy.scope}`,
    ),
    activeQuotas,
    policyEvents,
    providerErrorRate,
    providerFailedRequests,
    relatedServices,
  };
}

function buildIncidentActions(summary: ReturnType<typeof buildIncidentSummary>) {
  const actions: IncidentAction[] = [];

  if (summary.providerErrorRate >= 20) {
    actions.push({
      id: "provider:recovery",
      label: "Provider recovery",
      source: "Provider",
      severity: "critical",
      evidence: `${summary.providerErrorRate}% provider error rate across ${summary.providerFailedRequests} failed call${summary.providerFailedRequests === 1 ? "" : "s"}.`,
      action: {
        label: "Open service health",
        href: serviceDetailHref(summary.target, "health"),
      },
      priority: 0,
    });
  }

  if (summary.failedCalls > 0) {
    actions.push({
      id: "runtime:failed-calls",
      label: "Runtime failures",
      source: "Runtime",
      severity: "critical",
      evidence: `${summary.failedCalls} runtime call${summary.failedCalls === 1 ? "" : "s"} failed for ${summary.target}.`,
      action: {
        label: "Open service health",
        href: serviceDetailHref(summary.target, "health"),
      },
      priority: 1,
    });
  }

  for (const policy of summary.activeQuotas) {
    actions.push({
      id: `quota:${policy.id}`,
      label: `Active ${policy.mode} quota`,
      source: "Quotas",
      severity: policy.mode === "enforce" ? "warning" : "info",
      evidence: `${policy.mode} quota is active for ${policy.scope} ${policy.targetServiceId ?? summary.target} traffic.`,
      action: {
        label: "Open quota posture",
        href: serviceDetailHref(policy.ownerTribeId, "quotas"),
      },
      priority: 2,
    });
  }

  if (summary.policyEvents[0]) {
    actions.push({
      id: `audit:${summary.policyEvents[0].id}`,
      label: "Recent policy change",
      source: "Audit",
      severity:
        summary.policyEvents[0].severity === "error" ? "critical" : "info",
      evidence: summary.policyEvents[0].message,
      action: {
        label: "Open audit evidence",
        href: serviceDetailHref(summary.target, "evidence"),
      },
      priority: 3,
    });
  }

  return actions.sort(compareIncidentActions);
}

function serviceDetailHref(serviceId: string, section: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=${section}`;
}

function compareIncidentActions(left: IncidentAction, right: IncidentAction) {
  const severityDelta = incidentSeverityRank(left) - incidentSeverityRank(right);
  if (severityDelta !== 0) return severityDelta;
  const priorityDelta = left.priority - right.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return left.id.localeCompare(right.id);
}

function incidentSeverityRank(action: IncidentAction) {
  if (action.severity === "critical") return 0;
  if (action.severity === "warning") return 1;
  return 2;
}
