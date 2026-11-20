"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorPanel } from "@/components/patterns/notices";
import { Panel } from "@/components/patterns/panel";
import { projectHref } from "@/lib/app-navigation";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { controlPlane } from "../../data/control-plane-repository";
import { observability } from "../../data/observability";
import { baseMeter, USAGE_RANGES, type UsageRange } from "../../model/observability";
import { observabilityKeys, useQuotaUsage } from "../../view-models/observability";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";
import { QuotaMeterBar } from "../quotas/quota-meter";
import { UsageChart } from "./usage-chart";

const RANGE_TITLES: Record<UsageRange, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

/** Admitted requests over time, by application and action, and today's progress toward the daily budget. */
export function UsagePanel() {
  const { organizationId, project, kind } = useProjectEnvironment();
  const [range, setRange] = useState<UsageRange>("24h");
  const usage = useQuery({
    queryKey: observabilityKeys.usageSeries(organizationId, project.id, kind, range),
    queryFn: () => observability.usageSeries(organizationId, project.id, kind, range),
  });
  const applications = useQuery({
    queryKey: cpKeys.applications(organizationId, project.id, kind),
    queryFn: () => controlPlane.applications(organizationId, project.id, kind),
  });
  const names = new Map((applications.data ?? []).map((application) => [application.id, application.name]));
  const data = usage.data;

  return (
    <Panel
      title={RANGE_TITLES[range]}
      description="Requests admitted for this environment, by application and action."
      flush
      actions={<RangeSwitch value={range} onChange={setRange} />}
    >
      <DailyBudget />
      {usage.isLoading ? (
        <div className="p-4">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : usage.error || !data ? (
        <div className="p-4">
          <ErrorPanel title="Usage is unavailable" error={usage.error ?? new Error("No usage was returned")} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 divide-x border-b sm:grid-cols-4">
            <Stat label="Requests" value={formatNumber(data.totals.requests)} />
            <Stat label="Failed" value={formatNumber(data.totals.failed)} tone={data.totals.failed > 0 ? "danger" : undefined} />
            <Stat label="Failure rate" value={data.totals.requests ? `${((data.totals.failed / data.totals.requests) * 100).toFixed(1)}%` : "—"} />
            <Stat label="Applications" value={formatNumber(applications.data?.length)} href={projectHref(project.id, kind, "/applications")} />
          </div>
          {data.totals.requests === 0 ? (
            <EmptyState
              title={`No requests in the ${RANGE_TITLES[range].toLowerCase()}`}
              description="Requests made with this environment's keys appear here."
            />
          ) : (
            <>
              <div className="border-b px-4 pt-6 pb-3">
                <UsageChart usage={data} />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Application</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Failed</TableHead>
                    <TableHead className="hidden w-40 sm:table-cell">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byApplication.map((row) => (
                    <TableRow key={row.applicationId}>
                      <TableCell className="max-w-48 truncate">
                        <Link
                          href={projectHref(project.id, kind, `/applications/${encodeURIComponent(row.applicationId)}?tab=requests`)}
                          className="hover:underline"
                        >
                          {names.get(row.applicationId) ?? <span className="font-mono text-xs">{row.applicationId}</span>}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.requests)}</TableCell>
                      <TableCell className={cn("hidden text-right tabular-nums sm:table-cell", row.failed > 0 && "text-danger")}>
                        {formatNumber(row.failed)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                          <div
                            className="h-full rounded-full bg-foreground/60"
                            style={{
                              width: `${(row.requests / data.totals.requests) * 100}%`,
                            }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <details className="border-t text-[13px]">
                <summary className="cursor-pointer px-4 py-2.5 text-muted-foreground hover:text-foreground">By action ({data.byAction.length})</summary>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byAction.map((row) => (
                      <TableRow key={`${row.capability}|${row.action}`}>
                        <TableCell className="font-mono text-xs">{row.action}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.requests)}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", row.failed > 0 && "text-danger")}>{formatNumber(row.failed)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </details>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

/** Today's (UTC) progress toward the plan's or test default's daily request budget. */
function DailyBudget() {
  const { organizationId, project, kind } = useProjectEnvironment();
  const meters = useQuotaUsage(organizationId, project.id, kind);
  if (meters.isLoading || meters.error || !meters.data) return null;
  const meter = baseMeter(meters.data);
  const label =
    meters.data.baseBudget === "test-default"
      ? "Test default, today (UTC)"
      : meters.data.baseBudget === "unlimited"
        ? "Plan, today (UTC)"
        : meters.data.baseBudget === "plan"
          ? "Plan's daily requests, today (UTC)"
          : undefined;
  return (
    <div className="flex flex-col gap-1.5 border-b px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <p className="shrink-0 text-xs text-muted-foreground sm:w-48">{label ?? "Daily budget"}</p>
      {label ? (
        <QuotaMeterBar meter={meter} className="flex-1" />
      ) : (
        <p className="text-xs text-muted-foreground">
          {meters.data.baseBudget === "live-plan-required"
            ? "No plan is assigned, so live requests are refused."
            : "The assigned plan does not allow this environment."}
        </p>
      )}
    </div>
  );
}

function RangeSwitch({ value, onChange }: { value: UsageRange; onChange: (range: UsageRange) => void }) {
  return (
    <div role="radiogroup" aria-label="Time range" className="inline-flex h-7 items-center rounded-md border bg-muted/40 p-0.5">
      {USAGE_RANGES.map((range) => (
        <button
          key={range.value}
          type="button"
          role="radio"
          aria-checked={value === range.value}
          onClick={() => onChange(range.value)}
          className={cn(
            "h-6 rounded-sm px-2.5 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none",
            value === range.value && "bg-card text-foreground shadow-xs",
          )}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, tone, href }: { label: string; value: string; tone?: "danger"; href?: string }) {
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold tabular-nums", tone === "danger" && "text-danger")}>{value}</p>
    </>
  );
  return href ? (
    <Link href={href} className="px-4 py-3 transition-colors hover:bg-muted/40">
      {body}
    </Link>
  ) : (
    <div className="px-4 py-3">{body}</div>
  );
}
