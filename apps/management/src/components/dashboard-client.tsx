"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  DatabaseIcon,
  GaugeIcon,
  NetworkIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  getPlatformLifecycleEvidence,
  getQuotaUsage,
  listQuotaPolicies,
  listServices,
} from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import { getBrokenDependencies, getRegistrySummary } from "@/lib/registry-view";
import { DashboardAlertStrip } from "@/components/dashboard-alert-strip";
import { GatewayTrafficSummary } from "@/components/gateway-traffic-summary";
import { PlatformLifecyclePanel } from "@/components/platform-lifecycle-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  QuotaPolicy,
  QuotaUsageDecision,
  ServiceRegistryEntry,
} from "@/lib/schemas";

type QueueSeverity = "Critical" | "High" | "Medium" | "Info";
type QueueDomain = "Runtime" | "Registry" | "Quotas" | "Pipeline" | "Governance";

type ActionQueueItem = {
  id: string;
  title: string;
  severity: QueueSeverity;
  domain: QueueDomain;
  impact: string;
  owner: string;
  href: string;
  actionLabel: string;
  nextAction: string;
  evidence: string[];
};

const domainFilters: QueueDomain[] = [
  "Runtime",
  "Registry",
  "Quotas",
  "Pipeline",
  "Governance",
];

const severityRank: Record<QueueSeverity, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Info: 3,
};

export function DashboardClient() {
  const [selectedIssueId, setSelectedIssueId] = useState<string>();
  const servicesQuery = useQuery({
    queryKey: queryKeys.services,
    queryFn: listServices,
  });
  const quotaPoliciesQuery = useQuery({
    queryKey: queryKeys.quotaPolicies("all"),
    queryFn: () => listQuotaPolicies(),
    retry: 1,
  });
  const quotaUsageQuery = useQuery({
    queryKey: queryKeys.quotaUsage("all", "24h"),
    queryFn: () => getQuotaUsage({ window: "24h" }),
    retry: 1,
  });
  const lifecycleQuery = useQuery({
    queryKey: queryKeys.platformLifecycle,
    queryFn: getPlatformLifecycleEvidence,
    retry: false,
  });

  if (servicesQuery.isLoading) {
    return <DashboardLoadingState />;
  }

  if (servicesQuery.isError || !servicesQuery.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Registry unavailable</AlertTitle>
        <AlertDescription>
          Check the server environment variables and confirm API Center is
          reachable.
        </AlertDescription>
      </Alert>
    );
  }

  const services = servicesQuery.data;
  const quotaPolicies = quotaPoliciesQuery.data ?? [];
  const quotaUsage = quotaUsageQuery.data ?? [];
  const quotaPressure = quotaUsage.filter(isQuotaPressure);
  const summary = getRegistrySummary(services);
  const brokenDependencies = getBrokenDependencies(services);
  const actionQueue = buildActionQueue({
    services,
    quotaPolicies,
    quotaUsage,
  });
  const selectedIssue =
    actionQueue.find((item) => item.id === selectedIssueId) ?? actionQueue[0];
  const needsAttention =
    summary.unhealthy +
    summary.missingOwner +
    summary.missingHealthPath +
    brokenDependencies.length +
    quotaPressure.length;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-normal">
                Platform health
              </h1>
              <Badge
                variant={needsAttention > 0 ? "destructive" : "secondary"}
              >
                {needsAttention} needs attention
              </Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Live operating posture across service registry, runtime readiness,
              quotas, and governance evidence.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button nativeButton={false} render={<Link href="/readiness" />}>
              <ShieldCheckIcon data-icon="inline-start" />
              Readiness
            </Button>
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/tribes" />}
            >
              Open registry
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <HealthMetric
            label="Active services"
            value={summary.active}
            detail={`${summary.total} registered`}
            icon={DatabaseIcon}
          />
          <HealthMetric
            label="Critical issues"
            value={
              actionQueue.filter((item) => item.severity === "Critical").length
            }
            detail="Blocking or user-visible"
            icon={AlertTriangleIcon}
            attention
          />
          <HealthMetric
            label="Quota warnings"
            value={quotaPressure.length}
            detail={`${quotaPolicies.length} policies watched`}
            icon={GaugeIcon}
            attention={quotaPressure.length > 0}
          />
          <HealthMetric
            label="Broken deps"
            value={brokenDependencies.length}
            detail="Unknown consumed services"
            icon={NetworkIcon}
            attention={brokenDependencies.length > 0}
          />
          <HealthMetric
            label="Health-path evidence"
            value={summary.total - summary.missingHealthPath}
            detail="Services with health path"
            icon={CheckCircleIcon}
          />
        </div>
      </section>

      <PlatformLifecyclePanel
        lifecycle={lifecycleQuery.data}
        services={services}
        quotaPolicies={quotaPolicies}
        quotaUsage={quotaUsage}
        limit={4}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <section className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle>Action queue</CardTitle>
                  <CardDescription>
                    Severity-first worklist with enough context to choose the
                    next move without leaving the overview.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {domainFilters.map((domain) => (
                    <Badge key={domain} variant="outline">
                      {domain}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {actionQueue.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={item.title}
                  className={[
                    "grid w-full min-w-0 gap-3 rounded-lg border p-3 text-left transition-colors md:grid-cols-[7rem_minmax(0,1fr)_8rem]",
                    selectedIssue.id === item.id
                      ? "border-[var(--brand-green)] bg-[var(--brand-green-soft)]"
                      : "bg-background hover:bg-accent/60",
                  ].join(" ")}
                  onClick={() => setSelectedIssueId(item.id)}
                >
                  <span className="flex items-center gap-2">
                    <SeverityDot severity={item.severity} />
                    <span className="text-sm font-medium">
                      {item.severity}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {getQueueDisplayTitle(item)}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {item.impact}
                    </span>
                  </span>
                  <span className="flex items-center justify-start gap-1 text-xs font-medium text-muted-foreground md:justify-end">
                    {item.domain} domain
                    <ArrowRightIcon data-icon="inline-start" />
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>

          <DashboardAlertStrip />
          <GatewayTrafficSummary />
        </section>

        <aside className="min-w-0">
          <Card className="sticky top-24">
            <CardHeader>
              <CardTitle>Selected issue</CardTitle>
              <CardDescription>
                Decision detail for the highlighted queue item.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    Severity: {selectedIssue.severity}
                  </Badge>
                  <Badge variant="secondary">
                    {selectedIssue.domain} domain
                  </Badge>
                </div>
                <h2 className="mt-3 text-lg font-semibold tracking-normal">
                  {selectedIssue.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedIssue.impact}
                </p>
              </div>

              <DetailBlock label="Owner" value={selectedIssue.owner} />

              <div>
                <h3 className="text-sm font-medium">Evidence</h3>
                <ul className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
                  {selectedIssue.evidence.map((evidence) => (
                    <li key={evidence} className="flex gap-2">
                      <CircleDashedIcon
                        data-icon="inline-start"
                        className="mt-0.5 shrink-0 text-foreground"
                      />
                      <span>{evidence}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-medium">Next action</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedIssue.nextAction}
                </p>
              </div>

              <Button
                nativeButton={false}
                variant="outline"
                render={<Link href={selectedIssue.href} />}
              >
                {selectedIssue.actionLabel}
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function DashboardLoadingState() {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-normal">
                Platform health
              </h1>
              <Badge variant="secondary">Loading registry data</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Live operating posture across service registry, runtime readiness,
              quotas, and governance evidence.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button nativeButton={false} render={<Link href="/readiness" />}>
              <ShieldCheckIcon data-icon="inline-start" />
              Readiness
            </Button>
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/tribes" />}
            >
              Open registry
            </Button>
          </div>
        </div>
        <div
          role="status"
          aria-live="polite"
          className="mt-4 rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground"
        >
          Loading service registry, quotas, and governance evidence.
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            "Active services",
            "Critical issues",
            "Quota warnings",
            "Broken deps",
            "Health-path evidence",
          ].map((label) => (
            <div className="rounded-lg border bg-background p-3" key={label}>
              <div className="text-xs font-medium text-muted-foreground">
                {label}
              </div>
              <Skeleton className="mt-3 h-7 w-14" />
              <Skeleton className="mt-2 h-3 w-28" />
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <Card>
          <CardHeader>
            <CardTitle>Action queue</CardTitle>
            <CardDescription>
              Severity-first worklist will populate after registry signals load.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {["Runtime", "Registry", "Quotas"].map((domain) => (
              <div
                className="grid gap-3 rounded-lg border p-3 md:grid-cols-[7rem_minmax(0,1fr)_8rem]"
                key={domain}
              >
                <div className="text-sm font-medium text-muted-foreground">
                  Checking
                </div>
                <div className="min-w-0">
                  <Skeleton className="h-4 w-48 max-w-full" />
                  <Skeleton className="mt-2 h-3 w-64 max-w-full" />
                </div>
                <div className="text-xs font-medium text-muted-foreground md:text-right">
                  {domain} domain
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <aside className="min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>Selected issue</CardTitle>
              <CardDescription>
                Detail appears here when the first queue item is available.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function getQueueDisplayTitle(item: ActionQueueItem) {
  if (item.title === "Quota forecast crosses 90% this week") {
    return "Quota forecast over 90 percent this week";
  }

  return item.title;
}

function isQuotaPressure(usage: QuotaUsageDecision) {
  return (
    usage.outcome !== "allowed" ||
    usage.forecast?.status === "warning" ||
    usage.requestCount / usage.maxRequests >= 0.9
  );
}

function buildActionQueue({
  services,
  quotaPolicies,
  quotaUsage,
}: {
  services: ServiceRegistryEntry[];
  quotaPolicies: QuotaPolicy[];
  quotaUsage: QuotaUsageDecision[];
}) {
  const summary = getRegistrySummary(services);
  const brokenDependencies = getBrokenDependencies(services);
  const items: ActionQueueItem[] = [];

  if (summary.unhealthy > 0) {
    items.push({
      id: "runtime-unhealthy",
      title: "Runtime health degraded",
      severity: "Critical",
      domain: "Runtime",
      impact: `${summary.unhealthy} service${summary.unhealthy === 1 ? "" : "s"} marked unhealthy.`,
      owner: "Service owners",
      href: "/reliability",
      actionLabel: "Open reliability",
      nextAction: "Open reliability and rerun the failing health checks.",
      evidence: [
        `${summary.unhealthy} registry entries are not reporting active health.`,
        `${summary.missingHealthPath} services still need a health path.`,
      ],
    });
  }

  if (brokenDependencies.length > 0) {
    const first = brokenDependencies[0];
    items.push({
      id: "registry-broken-dependency",
      title: "Registry dependency is unresolved",
      severity: "Critical",
      domain: "Registry",
      impact: `${first.sourceServiceId} consumes ${first.targetServiceId}, but the target is not registered.`,
      owner: "Registry steward",
      href: `/tribes/${first.sourceServiceId}?section=dependencies`,
      actionLabel: "Open dependency detail",
      nextAction: "Open the source service dependencies and either register the target or remove the stale consume edge.",
      evidence: [
        `${brokenDependencies.length} broken dependency link${brokenDependencies.length === 1 ? "" : "s"} found.`,
        `${first.sourceServiceId} references ${first.targetServiceId}.`,
      ],
    });
  }

  for (const usage of quotaUsage.filter(isQuotaPressure)) {
    const percent =
      usage.maxRequests > 0
        ? Math.round((usage.requestCount / usage.maxRequests) * 100)
        : 0;
    items.push({
      id: `quota-${usage.policyId}`,
      title: "Quota forecast crosses 90% this week",
      severity: usage.outcome === "blocked" ? "Critical" : "High",
      domain: "Quotas",
      impact: `${usage.ownerTribeId} is at ${percent}% of the current quota window.`,
      owner: "Platform operations",
      href: `/tribes/${usage.ownerTribeId}?section=quotas`,
      actionLabel: "Open quota detail",
      nextAction: "Review quota policy",
      evidence: [
        `${usage.requestCount} of ${usage.maxRequests} requests used.`,
        `${quotaPolicies.length} quota policy${quotaPolicies.length === 1 ? "" : "ies"} monitored in the overview.`,
      ],
    });
  }

  if (summary.missingOwner > 0) {
    items.push({
      id: "governance-missing-owner",
      title: "Services are missing accountable owners",
      severity: "Medium",
      domain: "Governance",
      impact: `${summary.missingOwner} service${summary.missingOwner === 1 ? "" : "s"} need owner team or contact metadata.`,
      owner: "Governance reviewer",
      href: "/compliance",
      actionLabel: "Open compliance",
      nextAction: "Add owner and contact metadata before promotion review.",
      evidence: [
        `${summary.missingOwner} registry entries are missing accountability fields.`,
        "Promotion decisions should not proceed without an owner.",
      ],
    });
  }

  if (items.length === 0) {
    items.push({
      id: "all-clear",
      title: "No blocking issues in the command center",
      severity: "Info",
      domain: "Pipeline",
      impact: "Registry and quota signals do not need immediate action.",
      owner: "Platform operations",
      href: "/manifest-tools",
      actionLabel: "Open manifest tools",
      nextAction: "Run a manifest dry run before the next registry change.",
      evidence: [
        `${summary.active} active services are visible.`,
        "Quota usage is within policy thresholds.",
      ],
    });
  }

  return items.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      a.domain.localeCompare(b.domain) ||
      a.title.localeCompare(b.title),
  );
}

function HealthMetric({
  label,
  value,
  detail,
  icon: Icon,
  attention = false,
}: {
  label: string;
  value: number;
  detail: string;
  icon: React.ComponentType<{ "data-icon"?: string; className?: string }>;
  attention?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <Icon
          data-icon="inline-start"
          className={attention ? "text-destructive" : "text-muted-foreground"}
        />
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-normal">
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function SeverityDot({ severity }: { severity: QueueSeverity }) {
  const className =
    severity === "Critical"
      ? "bg-destructive"
      : severity === "High"
        ? "bg-[var(--warn)]"
        : severity === "Medium"
          ? "bg-[var(--brand-green)]"
          : "bg-muted-foreground";

  return <span className={`size-2 rounded-full ${className}`} />;
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
