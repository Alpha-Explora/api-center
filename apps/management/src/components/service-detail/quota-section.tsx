import Link from "next/link";
import { Detail } from "@/components/service-detail/detail";
import { Badge } from "@/components/ui/badge";
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

export function QuotaPostureCard({
  service,
  consumerCount,
  policies,
  usage,
  loading,
}: {
  service: ServiceRegistryEntry;
  consumerCount: number;
  policies: QuotaPolicy[];
  usage: QuotaUsageDecision[];
  loading: boolean;
}) {
  const activePolicy = policies.find((policy) => policy.status === "active");
  const strongestUsage = getStrongestQuotaUsage(usage);
  const usagePercent = strongestUsage
    ? getQuotaUsagePercent(strongestUsage)
    : null;

  return (
    <Card>
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Quota review</CardTitle>
          <CardDescription>
            Consumption review point before quota, readiness, or promotion work.
          </CardDescription>
        </div>
        <Link
          href={`/tribes/${encodeURIComponent(service.serviceId)}?section=quotas`}
          className="inline-flex text-sm font-medium underline-offset-4 hover:underline"
        >
          Open quota workspace
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-4 text-sm md:grid-cols-3">
          <Detail label="Service tier" value={service.serviceTier ?? "standard"} />
          <Detail label="Cost center" value={service.costCenter ?? "Not set"} />
          <Detail label="Consumer pressure" value={`${consumerCount} consumers`} />
        </dl>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="text-xs font-medium text-muted-foreground">
              Active policy
            </div>
            {loading ? (
              <Skeleton className="mt-3 h-14" />
            ) : activePolicy ? (
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all text-sm font-medium">
                    {activePolicy.id}
                  </span>
                  <Badge variant="secondary">{activePolicy.mode}</Badge>
                  <Badge variant="outline">{activePolicy.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {activePolicy.maxRequests.toLocaleString()} requests per{" "}
                  {formatQuotaWindow(activePolicy.windowSeconds)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {activePolicy.reason}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No active quota policy is attached to this service.
              </p>
            )}
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="text-xs font-medium text-muted-foreground">
              24h pressure
            </div>
            {loading ? (
              <Skeleton className="mt-3 h-14" />
            ) : strongestUsage ? (
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {strongestUsage.routeFamily}
                  </span>
                  <Badge variant={quotaOutcomeVariant(strongestUsage)}>
                    {strongestUsage.outcome.replace("_", " ")}
                  </Badge>
                  {strongestUsage.forecast?.status === "warning" ? (
                    <Badge variant="outline">forecast warning</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {strongestUsage.requestCount.toLocaleString()} of{" "}
                  {strongestUsage.maxRequests.toLocaleString()} requests
                </p>
                <p className="text-xs font-medium text-muted-foreground">
                  {usagePercent}% used
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No quota usage has been recorded for this service in the last
                24 hours.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function getStrongestQuotaUsage(usage: QuotaUsageDecision[]) {
  return [...usage].sort((left, right) => {
    const leftScore = quotaUsageScore(left);
    const rightScore = quotaUsageScore(right);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return getQuotaUsagePercent(right) - getQuotaUsagePercent(left);
  })[0];
}

function quotaUsageScore(usage: QuotaUsageDecision) {
  if (usage.outcome === "blocked") return 4;
  if (usage.outcome === "observed_exceeded") return 3;
  if (usage.forecast?.status === "warning") return 2;
  if (getQuotaUsagePercent(usage) >= 90) return 1;
  return 0;
}

function getQuotaUsagePercent(usage: QuotaUsageDecision) {
  return Math.round((usage.requestCount / usage.maxRequests) * 100);
}

function quotaOutcomeVariant(usage: QuotaUsageDecision) {
  if (usage.outcome === "blocked") return "destructive";
  if (usage.outcome === "observed_exceeded") return "outline";
  return "secondary";
}

function formatQuotaWindow(windowSeconds: number) {
  if (windowSeconds % 86400 === 0) {
    const days = windowSeconds / 86400;
    return days === 1 ? "1 day" : `${days} days`;
  }

  if (windowSeconds % 3600 === 0) {
    const hours = windowSeconds / 3600;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }

  if (windowSeconds % 60 === 0) {
    const minutes = windowSeconds / 60;
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }

  return `${windowSeconds} seconds`;
}
