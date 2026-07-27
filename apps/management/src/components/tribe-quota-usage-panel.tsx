"use client";

import Link from "next/link";
import { useState } from "react";
import { EyeIcon, RefreshCwIcon, ShieldAlertIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getQuotaUsage } from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import type { QuotaUsageDecision, QuotaUsageWindow } from "@/lib/schemas";
import { ActionFailedState, EmptyDataState } from "@/components/query-state";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const quotaUsageWindows: QuotaUsageWindow[] = ["1h", "24h", "7d", "30d"];

export function TribeQuotaUsagePanel({
  ownerTribeId,
}: {
  ownerTribeId?: string;
}) {
  const [filterOwnerTribeId, setFilterOwnerTribeId] = useState(
    ownerTribeId ?? "",
  );
  const [window, setWindow] = useState<QuotaUsageWindow>("24h");
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const usageQuery = useQuery({
    queryKey: queryKeys.quotaUsage(filterOwnerTribeId || "all", window),
    queryFn: () =>
      getQuotaUsage({
        ownerTribeId: filterOwnerTribeId || undefined,
        window,
      }),
    retry: 1,
  });
  const quotaActions = buildQuotaActions(usageQuery.data ?? []);
  const selectedAction =
    quotaActions.find((action) => action.id === selectedActionId) ??
    quotaActions[0];

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <CardTitle>Quota usage</CardTitle>
          <CardDescription>
            Review recent quota decisions before moving policies from observe to
            enforce.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field className="min-w-56">
            <FieldLabel htmlFor="quota-usage-owner-filter">
              Filter by owner tribe ID
            </FieldLabel>
            <Input
              id="quota-usage-owner-filter"
              value={filterOwnerTribeId}
              onChange={(event) => setFilterOwnerTribeId(event.target.value)}
              placeholder="All tribes"
            />
          </Field>
          <QuotaWindowSelector value={window} onChange={setWindow} />
          <Button
            type="button"
            variant="outline"
            onClick={() => usageQuery.refetch()}
            disabled={usageQuery.isFetching}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {usageQuery.isLoading ? (
          <Skeleton className="h-80 rounded-xl" />
        ) : usageQuery.isError ? (
          <ActionFailedState
            title="Could not load quota usage"
            description="Check the quota usage endpoint and API Center admin credentials."
            recoverySteps={[
              {
                label: "Check quota usage endpoint",
                description:
                  "Usage review depends on gateway and Kafka quota decisions.",
              },
              {
                label: "Retry the selected window",
                description:
                  "Keep the owner filter and refresh after the endpoint responds.",
              },
            ]}
          />
        ) : usageQuery.data ? (
          <div className="flex flex-col gap-4">
            <QuotaActionReview
              actions={quotaActions}
              selectedAction={selectedAction}
              onSelectAction={setSelectedActionId}
            />
            {usageQuery.data.length ? (
              <UsageTable decisions={usageQuery.data} />
            ) : (
              <EmptyDataState
                title="No quota decisions in this window"
                description="Quota usage appears after gateway traffic or Kafka publishes are evaluated by API Center."
              />
            )}
          </div>
        ) : (
          <EmptyDataState
            title="No quota decisions in this window"
            description="Quota usage appears after gateway traffic or Kafka publishes are evaluated by API Center."
          />
        )}
      </CardContent>
    </Card>
  );
}

type QuotaActionSeverity = "critical" | "warning" | "info";

type QuotaAction = {
  id: string;
  label: string;
  ownerTribeId: string;
  source: string;
  severity: QuotaActionSeverity;
  evidence: string;
  href: string;
  priority: number;
};

function QuotaActionReview({
  actions,
  selectedAction,
  onSelectAction,
}: {
  actions: QuotaAction[];
  selectedAction?: QuotaAction;
  onSelectAction: (actionId: string) => void;
}) {
  if (!actions.length) {
    return (
      <section className="rounded-lg border bg-muted/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldAlertIcon data-icon="inline-start" />
          Quota action review
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          No quota decisions need review in this window.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.8fr)]">
      <div className="overflow-hidden rounded-lg border">
        <div className="hidden grid-cols-[minmax(11rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Decision</span>
          <span>Severity</span>
          <span>Evidence</span>
          <span className="sr-only">Inspect</span>
        </div>
        <div className="divide-y">
          {actions.map((action) => (
            <QuotaActionRow
              key={action.id}
              action={action}
              selected={action.id === selectedAction?.id}
              onSelect={() => onSelectAction(action.id)}
            />
          ))}
        </div>
      </div>
      {selectedAction ? <QuotaActionDetail action={selectedAction} /> : null}
    </section>
  );
}

function QuotaActionRow({
  action,
  selected,
  onSelect,
}: {
  action: QuotaAction;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 md:grid-cols-[minmax(11rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] md:items-start">
      <div className="min-w-0">
        <div className="truncate font-medium">{action.label}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">
          {action.ownerTribeId}
        </div>
      </div>
      <div className="col-start-1 md:col-auto">
        <QuotaSeverityBadge severity={action.severity} />
      </div>
      <div className="col-start-1 min-w-0 break-words text-sm text-muted-foreground md:col-auto">
        {action.evidence}
      </div>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect quota action ${action.source}`}
        title={`Inspect quota action ${action.source}`}
        onClick={onSelect}
        className="col-start-2 row-start-1 inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground md:col-auto md:row-auto"
      >
        <EyeIcon data-icon="inline-end" />
      </button>
    </div>
  );
}

function QuotaActionDetail({ action }: { action: QuotaAction }) {
  return (
    <aside
      aria-label="Selected quota action detail"
      className="order-first rounded-lg border bg-muted/10 p-4 xl:order-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Selected quota action</div>
          <div className="mt-1 truncate text-base font-medium">
            {action.label}
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {action.ownerTribeId} / {action.source}
          </div>
        </div>
        <QuotaSeverityBadge severity={action.severity} />
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
          href={action.href}
          className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          Open quota policy
          <ShieldAlertIcon data-icon="inline-end" />
        </Link>
      </div>
    </aside>
  );
}

function buildQuotaActions(decisions: QuotaUsageDecision[]) {
  return decisions
    .flatMap((decision): QuotaAction[] => {
      if (decision.outcome === "blocked") {
        return [
          {
            id: `blocked:${decision.id}`,
            label: "Review enforced quota blocks",
            ownerTribeId: decision.ownerTribeId,
            source: "Enforced blocks",
            severity: "critical",
            evidence: `${decision.requestCount} of ${decision.maxRequests} requests were blocked for ${formatDecisionTarget(decision)}.`,
            href: quotaPolicyHref(decision),
            priority: 0,
          },
        ];
      }

      if (decision.outcome === "observed_exceeded") {
        return [
          {
            id: `observed:${decision.id}`,
            label: "Review observe-mode exceedance",
            ownerTribeId: decision.ownerTribeId,
            source: "Observe-mode exceedance",
            severity: "warning",
            evidence: `${decision.requestCount} of ${decision.maxRequests} requests exceeded the observed quota for ${formatDecisionTarget(decision)}.`,
            href: quotaPolicyHref(decision),
            priority: 1,
          },
        ];
      }

      if (decision.forecast?.status === "warning") {
        return [
          {
            id: `forecast:${decision.id}`,
            label: "Review quota forecast",
            ownerTribeId: decision.ownerTribeId,
            source: "Forecast warning",
            severity: "warning",
            evidence: `Projected monthly usage is ${decision.forecast.projectedMonthlyUsage.toLocaleString()} calls for ${formatDecisionTarget(decision)}.`,
            href: quotaPolicyHref(decision),
            priority: 2,
          },
        ];
      }

      return [];
    })
    .sort(compareQuotaActions);
}

function compareQuotaActions(left: QuotaAction, right: QuotaAction) {
  const severityDelta = severityRank(left.severity) - severityRank(right.severity);
  if (severityDelta !== 0) return severityDelta;
  const priorityDelta = left.priority - right.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return left.ownerTribeId.localeCompare(right.ownerTribeId);
}

function severityRank(severity: QuotaActionSeverity) {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function QuotaSeverityBadge({ severity }: { severity: QuotaActionSeverity }) {
  if (severity === "critical") {
    return <Badge variant="destructive">critical</Badge>;
  }
  if (severity === "warning") return <Badge variant="secondary">warning</Badge>;
  return <Badge variant="outline">info</Badge>;
}

function quotaPolicyHref(decision: QuotaUsageDecision) {
  const serviceId = decision.targetServiceId ?? decision.ownerTribeId;
  return `/tribes/${encodeURIComponent(serviceId)}?section=quotas`;
}

function formatDecisionTarget(decision: QuotaUsageDecision) {
  return decision.targetServiceId ?? decision.routeFamily;
}

function QuotaWindowSelector({
  value,
  onChange,
}: {
  value: QuotaUsageWindow;
  onChange: (value: QuotaUsageWindow) => void;
}) {
  return (
    <div
      className="flex rounded-full border bg-background p-1"
      aria-label="Select quota usage window"
    >
      {quotaUsageWindows.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={cn(
            "h-8 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors",
            value === option && "bg-primary text-primary-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function UsageTable({ decisions }: { decisions: QuotaUsageDecision[] }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tribe</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Target service</TableHead>
            <TableHead>Current window</TableHead>
            <TableHead>Request count</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Last exceeded</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {decisions.map((decision) => (
            <TableRow key={decision.id}>
              <TableCell className="font-mono text-xs">
                {decision.ownerTribeId}
              </TableCell>
              <TableCell>{decision.scope.replace("_", " ")}</TableCell>
              <TableCell>{decision.targetServiceId ?? "All targets"}</TableCell>
              <TableCell>
                <span className="block font-mono text-xs">
                  {decision.windowStart}
                </span>
                <span className="block font-mono text-xs text-muted-foreground">
                  {decision.windowEnd}
                </span>
              </TableCell>
              <TableCell>
                {decision.requestCount} / {decision.maxRequests}
              </TableCell>
              <TableCell>{decision.mode}</TableCell>
              <TableCell>
                <Badge
                  variant={
                    decision.outcome === "blocked" ? "destructive" : "secondary"
                  }
                  className={cn(
                    decision.outcome === "observed_exceeded" &&
                      "bg-[#fff8e7] text-[#8a5200]",
                    decision.outcome === "allowed" &&
                      "bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]",
                  )}
                >
                  {decision.outcome.replace("_", " ")}
                </Badge>
              </TableCell>
              <TableCell>
                {decision.outcome === "allowed"
                  ? "Not exceeded"
                  : decision.createdAt}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
