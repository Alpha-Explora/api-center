"use client";

import { type ReactNode, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  ActivityIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  EyeIcon,
  MinusIcon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  getSharedServiceRuntimeUsage,
  listServices,
} from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import { getDeclaredSharedServiceUsage } from "@/lib/shared-service-usage";
import type {
  SharedServiceRuntimeUsage,
  SharedServiceUsageWindow,
} from "@/lib/schemas";
import {
  getUsageReviewSignals,
  pairKey,
  serviceDependencyHref,
  serviceDetailHref,
  type UsageReviewSignal,
  usageSignalAction,
  usageSignalEvidence,
  usageSignalStatus,
} from "@/components/shared-service-usage-matrix/usage-signals";
import {
  getRuntimeSummary,
  indexRuntimeUsage,
  sharedServiceLabel,
} from "@/components/shared-service-usage-matrix/usage-runtime-summary";
import {
  ActionFailedState,
  EmptyDataState,
  SetupRequiredState,
} from "@/components/query-state";
import { AccessReviewPanel } from "@/components/access-review-panel";
import { TimeWindowSelector } from "@/components/time-window-selector";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const MATRIX_PAGE_SIZE = 8;

export function SharedServiceUsageMatrix() {
  const [window, setWindow] = useState<SharedServiceUsageWindow>("24h");
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedSignalKey, setSelectedSignalKey] = useState<string>();
  const servicesQuery = useQuery({
    queryKey: queryKeys.services,
    queryFn: listServices,
  });
  const runtimeUsageQuery = useQuery({
    queryKey: queryKeys.sharedServiceUsage(window),
    queryFn: () => getSharedServiceRuntimeUsage(window),
    retry: 1,
  });
  const runtimeByPair = useMemo(
    () => indexRuntimeUsage(runtimeUsageQuery.data ?? []),
    [runtimeUsageQuery.data],
  );
  const runtimeSummary = getRuntimeSummary(runtimeUsageQuery.data ?? []);

  if (servicesQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (servicesQuery.isError || !servicesQuery.data) {
    return (
      <ActionFailedState
        title="Could not load registry usage"
        description="Check management env, API Center readiness, and protected registry access."
        recoverySteps={[
          {
            label: "Check protected registry access",
            description:
              "Shared-service usage needs the service registry before runtime signals can be reviewed.",
          },
          {
            label: "Run readiness checks",
            description:
              "Verify API Center connectivity before changing shared-service declarations.",
          },
        ]}
      />
    );
  }

  const usage = getDeclaredSharedServiceUsage(servicesQuery.data);
  const totalPages = Math.max(
    1,
    Math.ceil(usage.rows.length / MATRIX_PAGE_SIZE),
  );
  const activePage = Math.min(currentPage, totalPages - 1);
  const pageStart = activePage * MATRIX_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + MATRIX_PAGE_SIZE, usage.rows.length);
  const pagedRows = usage.rows.slice(pageStart, pageEnd);
  const showPagination = usage.rows.length > MATRIX_PAGE_SIZE;
  const reviewSignals = getUsageReviewSignals(
    usage.rows,
    runtimeUsageQuery.data ?? [],
    new Set(servicesQuery.data.map((service) => service.serviceId)),
  );
  const selectedSignal =
    reviewSignals.find((signal) => signal.key === selectedSignalKey) ??
    reviewSignals[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard
          title="Tribes"
          value={usage.summary.tribeCount}
          description="Registry services with tribe routing"
        />
        <SummaryCard
          title="Declared links"
          value={usage.summary.declaredLinkCount}
          description="Manifest consumes relationships"
        />
        <SummaryCard
          title="Most consumed"
          value={
            usage.summary.mostConsumedSharedService
              ? sharedServiceLabel(usage.summary.mostConsumedSharedService)
              : "None"
          }
          description="Highest declared shared-service dependency"
          mono
        />
        <SummaryCard
          title="Missing registrations"
          value={usage.summary.missingRegistrationCount}
          description="Declared shared services not registered"
          attention={usage.summary.missingRegistrationCount > 0}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard
          title="Runtime calls"
          value={runtimeSummary.totalRequests}
          description={`Actual shared-service calls over ${window}`}
        />
        <SummaryCard
          title="Runtime failures"
          value={runtimeSummary.failedRequests}
          description="Failed proxied shared-service calls"
          attention={runtimeSummary.failedRequests > 0}
        />
        <SummaryCard
          title="Error rate"
          value={`${(runtimeSummary.errorRate * 100).toFixed(1)}%`}
          description="Failures divided by total runtime calls"
          attention={runtimeSummary.errorRate >= 0.05}
        />
        <SummaryCard
          title="Avg latency"
          value={`${runtimeSummary.avgLatencyMs}ms`}
          description="Weighted average proxy latency"
          mono
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Shared-service usage matrix</CardTitle>
            <CardDescription>
              Registry declarations plus API Center runtime calls for the
              selected window.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TimeWindowSelector value={window} onChange={setWindow} />
            <Button
              variant="outline"
              onClick={() => {
                servicesQuery.refetch();
                runtimeUsageQuery.refetch();
              }}
              disabled={
                servicesQuery.isFetching || runtimeUsageQuery.isFetching
              }
            >
              <RefreshCwIcon data-icon="inline-start" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {usage.rows.length ? (
            <div className="flex flex-col gap-4">
              {runtimeSummary.totalRequests === 0 ? (
                <Alert>
                  <AlertTitle>No runtime calls in this window</AlertTitle>
                  <AlertDescription>
                    The registry declarations are still shown. Runtime counts
                    appear after tribes call shared services through API Center
                    and the analytics endpoint reports the selected window.
                  </AlertDescription>
                </Alert>
              ) : null}
              {reviewSignals.length ? (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.8fr)]">
                  <div className="overflow-hidden rounded-lg border">
                    <div className="hidden grid-cols-[minmax(10rem,0.9fr)_minmax(9rem,0.7fr)_7rem_minmax(9rem,0.8fr)_2.25rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
                      <span>Tribe</span>
                      <span>Shared service</span>
                      <span>Status</span>
                      <span>Evidence</span>
                      <span className="sr-only">Inspect</span>
                    </div>
                    <div className="divide-y">
                      {reviewSignals.map((signal) => (
                        <UsageReviewRow
                          key={signal.key}
                          signal={signal}
                          selected={signal.key === selectedSignal?.key}
                          onSelect={() => setSelectedSignalKey(signal.key)}
                        />
                      ))}
                    </div>
                  </div>
                  {selectedSignal ? (
                    <UsageReviewDetail signal={selectedSignal} />
                  ) : null}
                </div>
              ) : (
                <Alert>
                  <AlertTitle>No usage review signals</AlertTitle>
                  <AlertDescription>
                    There are no runtime calls or shared-service registration
                    issues in the selected window. Use the matrix below for the
                    declared manifest view.
                  </AlertDescription>
                </Alert>
              )}
              <div className="overflow-hidden rounded-lg border bg-card">
                <Table aria-label="Declared shared-service usage matrix">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tribe</TableHead>
                      {usage.expectedSharedServiceIds.map((serviceId) => (
                        <TableHead key={serviceId} className="text-center">
                          {sharedServiceLabel(serviceId)}
                        </TableHead>
                      ))}
                      <TableHead className="text-right">Declared</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedRows.map((row) => (
                      <TableRow key={row.tribe.serviceId}>
                        <TableCell>
                          <div className="flex min-w-56 flex-col">
                            <Link
                              href={serviceDependencyHref(row.tribe.serviceId)}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {row.tribe.name}
                            </Link>
                            <span className="font-mono text-xs text-muted-foreground">
                              {row.tribe.serviceId}
                            </span>
                            <Link
                              href={serviceDetailHref(row.tribe.serviceId, "quotas")}
                              aria-label={`Open quotas for ${row.tribe.serviceId}`}
                              className="mt-1 w-fit text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                            >
                              Quotas
                            </Link>
                          </div>
                        </TableCell>
                        {row.cells.map((cell) => (
                          <TableCell
                            key={cell.sharedServiceId}
                            className="text-center"
                          >
                            <UsageCell
                              declared={cell.declared}
                              registered={cell.registered}
                              runtime={runtimeByPair.get(
                                pairKey(
                                  row.tribe.serviceId,
                                  cell.sharedServiceId,
                                ),
                              )}
                            />
                          </TableCell>
                        ))}
                        <TableCell className="text-right">
                          <Badge
                            variant="secondary"
                            className={cn(
                              row.missingCount
                                ? "bg-[#fff8e7] text-[#9a5b00]"
                                : "bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]",
                            )}
                          >
                            {row.declaredCount}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {showPagination ? (
                <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    Showing {pageStart + 1}-{pageEnd} of {usage.rows.length}{" "}
                    tribes
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage((page) => Math.max(page - 1, 0))
                      }
                      disabled={activePage === 0}
                      aria-label="Previous page"
                    >
                      <ChevronLeftIcon data-icon="inline-start" />
                      Previous
                    </Button>
                    <span className="font-mono text-xs">
                      {activePage + 1}/{totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage((page) =>
                          Math.min(page + 1, totalPages - 1),
                        )
                      }
                      disabled={activePage >= totalPages - 1}
                      aria-label="Next page"
                    >
                      Next
                      <ChevronRightIcon data-icon="inline-end" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyDataState
              title="No tribe services registered"
              description="Register tribe manifests first. Shared-service usage is derived from each tribe's consumes list."
            />
          )}
        </CardContent>
      </Card>

      {runtimeUsageQuery.isError ? (
        <SetupRequiredState
          title="Runtime usage endpoint is not available"
          description="The declared matrix still works. Deploy the API Center analytics endpoint or check API_CENTER_PLATFORM_ADMIN_SECRET to show live call counts."
        />
      ) : null}

      <AccessReviewPanel
        services={servicesQuery.data}
        runtimeUsage={runtimeUsageQuery.data ?? []}
        window={window}
      />
    </div>
  );
}

function UsageCell({
  declared,
  registered,
  runtime,
}: {
  declared: boolean;
  registered: boolean;
  runtime?: SharedServiceRuntimeUsage;
}) {
  const totalRequests = runtime?.totalRequests ?? 0;
  const hasRuntime = totalRequests > 0;
  const highErrorRate = (runtime?.errorRate ?? 0) >= 0.05;

  if (runtime && hasRuntime && (!declared || highErrorRate)) {
    return (
      <RuntimeCell
        icon={<XCircleIcon data-icon="inline-start" />}
        className="bg-[#fff7f7] text-destructive"
        runtime={runtime}
      />
    );
  }

  if (runtime && declared && registered && hasRuntime) {
    return (
      <RuntimeCell
        icon={<CheckIcon data-icon="inline-start" />}
        className="bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]"
        runtime={runtime}
      />
    );
  }

  if (declared && registered) {
    return (
      <span
        title="Declared, registered, no runtime calls in selected window"
        className="inline-flex size-7 items-center justify-center rounded-full bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]"
      >
        <CheckIcon data-icon="inline-start" />
      </span>
    );
  }

  if (declared && !registered) {
    return (
      <span
        title="Declared by tribe, but the shared service is not registered"
        className="inline-flex size-7 items-center justify-center rounded-full bg-[#fff8e7] text-[#9a5b00]"
      >
        <AlertTriangleIcon data-icon="inline-start" />
      </span>
    );
  }

  return (
    <span
      title="Not declared and no runtime calls"
      className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground"
    >
      <MinusIcon data-icon="inline-start" />
    </span>
  );
}

function RuntimeCell({
  runtime,
  icon,
  className,
}: {
  runtime: SharedServiceRuntimeUsage;
  icon: ReactNode;
  className: string;
}) {
  return (
    <div className="flex min-w-24 flex-col items-center gap-1">
      <span
        title={`${runtime.totalRequests} calls, ${(runtime.errorRate * 100).toFixed(1)}% errors, ${runtime.avgLatencyMs}ms avg`}
        className={cn(
          "inline-flex size-7 items-center justify-center rounded-full",
          className,
        )}
      >
        {icon}
      </span>
      <span className="font-mono text-xs text-foreground">
        {runtime.totalRequests}
      </span>
      <span className="text-[11px] text-muted-foreground">
        {(runtime.errorRate * 100).toFixed(1)}% / {runtime.avgLatencyMs}ms
      </span>
    </div>
  );
}

function UsageReviewRow({
  signal,
  selected,
  onSelect,
}: {
  signal: UsageReviewSignal;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = usageSignalStatus(signal);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 md:grid-cols-[minmax(10rem,0.9fr)_minmax(9rem,0.7fr)_7rem_minmax(9rem,0.8fr)_2.25rem] md:items-start">
      <div className="min-w-0">
        <Link
          href={serviceDependencyHref(signal.tribeServiceId)}
          className="truncate font-medium underline-offset-4 hover:underline"
        >
          {signal.tribeName}
        </Link>
        <div className="truncate font-mono text-xs text-muted-foreground">
          {signal.tribeServiceId}
        </div>
      </div>
      <div className="col-start-1 min-w-0 md:col-auto">
        {signal.registered ? (
          <Link
            href={serviceDependencyHref(signal.sharedServiceId)}
            className="truncate font-medium underline-offset-4 hover:underline"
          >
            {signal.sharedServiceId}
          </Link>
        ) : (
          <div className="truncate font-medium">{signal.sharedServiceId}</div>
        )}
        <div className="text-xs text-muted-foreground">
          {signal.declared ? "declared" : "not declared"}
        </div>
      </div>
      <div className="col-start-1 md:col-auto">
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      <div className="col-start-1 min-w-0 break-words text-sm text-muted-foreground md:col-auto">
        {usageSignalEvidence(signal)}
      </div>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect shared-service usage ${signal.tribeServiceId} to ${signal.sharedServiceId}`}
        title={`Inspect shared-service usage ${signal.tribeServiceId} to ${signal.sharedServiceId}`}
        onClick={onSelect}
        className="col-start-2 row-start-1 inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground md:col-auto md:row-auto"
      >
        <EyeIcon data-icon="inline-end" />
      </button>
    </div>
  );
}

function UsageReviewDetail({ signal }: { signal: UsageReviewSignal }) {
  const status = usageSignalStatus(signal);
  const action = usageSignalAction(signal);

  return (
    <aside
      aria-label="Selected shared-service usage detail"
      className="order-first rounded-lg border bg-muted/10 p-4 xl:order-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Selected usage signal</div>
          <div className="mt-1 truncate text-base font-medium">
            {signal.tribeServiceId} to {signal.sharedServiceId}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {signal.tribeName} consuming {signal.sharedServiceId}
          </div>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      <div className="mt-4 grid gap-3 border-t pt-4 text-xs sm:grid-cols-2">
        <DetailSignal label="Declared" value={signal.declared ? "yes" : "no"} />
        <DetailSignal
          label="Registered"
          value={signal.registered ? "yes" : "no"}
        />
        <DetailSignal
          label="Runtime calls"
          value={String(signal.runtime?.totalRequests ?? 0)}
        />
        <DetailSignal
          label="Avg latency"
          value={`${signal.runtime?.avgLatencyMs ?? 0}ms`}
        />
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">Evidence</div>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {usageSignalEvidence(signal)}
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
          {action.label}
          <ActivityIcon data-icon="inline-end" />
        </Link>
      </div>
    </aside>
  );
}

function DetailSignal({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium">{value}</div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  description,
  attention,
  mono,
}: {
  title: string;
  value: number | string;
  description: string;
  attention?: boolean;
  mono?: boolean;
}) {
  return (
    <Card className={attention ? "border-destructive/30 bg-[#fff7f7]" : ""}>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p
          className={cn(
            "text-3xl font-semibold tracking-[-0.03em]",
            mono && "font-mono text-2xl",
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
