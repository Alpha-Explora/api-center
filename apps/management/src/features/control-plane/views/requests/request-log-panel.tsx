"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ActivityIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IdText } from "@/components/patterns/copy-button";
import { EmptyState } from "@/components/patterns/empty-state";
import { NativeSelect } from "@/components/patterns/form";
import { ErrorPanel } from "@/components/patterns/notices";
import { DescriptionList, Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { projectHref } from "@/lib/app-navigation";
import { formatDateTime, formatRelative } from "@/lib/format";
import { controlPlane } from "../../data/control-plane-repository";
import {
  describeFailureStage,
  formatDuration,
  REQUEST_RANGES,
  STATUS_CLASSES,
  statusCodeTone,
  type RequestLogEntry,
  type RequestLogFilters,
  type RequestRange,
  type StatusClass,
} from "../../model/observability";
import { useAnchoredNow, useRequestLog } from "../../view-models/observability";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";

/**
 * Recent requests made by the environment's applications, newest first. With `applicationId`, only that
 * application's requests and no application filter.
 */
export function RequestLogPanel({ applicationId }: { applicationId?: string }) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const [filters, setFilters] = useState<RequestLogFilters>({
    range: "24h",
    applicationId,
  });
  const { now, refresh } = useAnchoredNow();
  const log = useRequestLog(organizationId, project.id, kind, filters, now);
  const applications = useQuery({
    queryKey: cpKeys.applications(organizationId, project.id, kind),
    queryFn: () => controlPlane.applications(organizationId, project.id, kind),
    retry: false,
  });
  const names = new Map((applications.data ?? []).map((application) => [application.id, application.name]));
  const [selected, setSelected] = useState<RequestLogEntry | null>(null);
  const entries = log.data?.pages.flatMap((page) => page.items) ?? [];
  const set = (patch: Partial<RequestLogFilters>) => setFilters((current) => ({ ...current, ...patch }));

  return (
    <Panel
      title={applicationId ? "Requests" : "Recent requests"}
      description="Method, route, status and timing of each request. Bodies, query strings and keys are never recorded. Kept for 30 days."
      flush
      actions={
        <Button size="sm" variant="outline" onClick={refresh} disabled={log.isFetching}>
          <RefreshCwIcon data-icon="inline-start" /> Refresh
        </Button>
      }
    >
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:flex-wrap">
        {applicationId ? null : (
          <NativeSelect
            aria-label="Application"
            className="sm:w-56"
            value={filters.applicationId ?? ""}
            onChange={(event) => set({ applicationId: event.target.value || undefined })}
          >
            <option value="">All applications</option>
            {(applications.data ?? []).map((application) => (
              <option key={application.id} value={application.id}>
                {application.name}
              </option>
            ))}
          </NativeSelect>
        )}
        <NativeSelect
          aria-label="Status"
          className="sm:w-48"
          value={filters.status ?? ""}
          onChange={(event) =>
            set({
              status: (event.target.value || undefined) as StatusClass | undefined,
            })
          }
        >
          <option value="">Any status</option>
          {STATUS_CLASSES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Time range"
          className="sm:w-44"
          value={filters.range}
          onChange={(event) => set({ range: event.target.value as RequestRange })}
        >
          {REQUEST_RANGES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      {log.isPending ? (
        <div className="flex flex-col gap-2 p-4" role="status">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : log.error && entries.length === 0 ? (
        <div className="p-4">
          <ErrorPanel title="The request log could not be loaded" error={log.error} />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<ActivityIcon />}
          title="No requests match"
          description={
            filters.status || (filters.applicationId && !applicationId)
              ? "Try another status, application or a longer time range."
              : `Requests made with this ${kind} environment's keys appear here within seconds.`
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Status</TableHead>
                {applicationId ? null : <TableHead className="hidden md:table-cell">Application</TableHead>}
                <TableHead className="hidden text-right sm:table-cell">Duration</TableHead>
                <TableHead className="hidden lg:table-cell">Failed at</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.requestId} className="cursor-pointer" onClick={() => setSelected(entry)}>
                  <TableCell className="max-w-36 sm:max-w-80">
                    <button
                      type="button"
                      className="block w-full truncate text-left font-mono text-xs hover:underline focus-visible:underline focus-visible:outline-none"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected(entry);
                      }}
                    >
                      <span className="font-semibold">{entry.method}</span> {entry.route}
                    </button>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={statusCodeTone(entry.statusCode)}>{entry.statusCode}</StatusBadge>
                  </TableCell>
                  {applicationId ? null : (
                    <TableCell className="hidden max-w-40 truncate md:table-cell">
                      {entry.applicationId ? (names.get(entry.applicationId) ?? <span className="font-mono text-xs">{entry.applicationId}</span>) : "—"}
                    </TableCell>
                  )}
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatDuration(entry.durationMs)}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {entry.failureStage ? <span className="text-[13px]">{entry.failureStage}</span> : <span className="text-muted-foreground">—</span>}
                    {entry.errorCode ? <span className="ml-2 font-mono text-xs text-muted-foreground">{entry.errorCode}</span> : null}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground" title={formatDateTime(entry.occurredAt)}>
                    {formatRelative(entry.occurredAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-xs text-muted-foreground">
            <span>
              {entries.length.toLocaleString("en")} request
              {entries.length === 1 ? "" : "s"} shown
            </span>
            {log.hasNextPage ? (
              <Button size="sm" variant="outline" onClick={() => void log.fetchNextPage()} disabled={log.isFetchingNextPage}>
                {log.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            ) : (
              <span>End of the range</span>
            )}
          </div>
          {log.isFetchNextPageError ? (
            <div className="border-t p-4">
              <ErrorPanel title="The next page could not be loaded" error={log.error} />
            </div>
          ) : null}
        </>
      )}

      <RequestSheet
        entry={selected}
        applicationName={selected?.applicationId ? names.get(selected.applicationId) : undefined}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </Panel>
  );
}

function RequestSheet({
  entry,
  applicationName,
  onOpenChange,
}: {
  entry: RequestLogEntry | null;
  applicationName?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { project, kind } = useProjectEnvironment();
  const failure = describeFailureStage(entry?.failureStage ?? null);
  return (
    <Sheet open={entry !== null} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        {entry ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <StatusBadge tone={statusCodeTone(entry.statusCode)}>{entry.statusCode}</StatusBadge>
                <span className="truncate font-mono text-sm">
                  {entry.method} {entry.route}
                </span>
              </SheetTitle>
              <SheetDescription>{formatDateTime(entry.occurredAt)}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
              {failure ? (
                <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[13px]">
                  <p className="font-medium">Failed at {entry.failureStage}</p>
                  <p className="mt-0.5 text-muted-foreground">{failure}</p>
                  {entry.errorCode ? <p className="mt-1 font-mono text-xs text-muted-foreground">{entry.errorCode}</p> : null}
                </div>
              ) : null}
              <DescriptionList
                items={[
                  {
                    label: "Application",
                    value: entry.applicationId ? (
                      <Link
                        href={projectHref(project.id, kind, `/applications/${encodeURIComponent(entry.applicationId)}?tab=requests`)}
                        className="hover:underline"
                      >
                        {applicationName ?? <span className="font-mono text-xs">{entry.applicationId}</span>}
                      </Link>
                    ) : (
                      "—"
                    ),
                  },
                  {
                    label: "Route",
                    value: <span className="font-mono text-xs break-all">{entry.route}</span>,
                  },
                  {
                    label: "Duration",
                    value: formatDuration(entry.durationMs),
                  },
                  {
                    label: "Error code",
                    value: entry.errorCode ? <span className="font-mono text-xs">{entry.errorCode}</span> : "—",
                  },
                  {
                    label: "Correlation ID",
                    value: <IdText value={entry.correlationId} />,
                  },
                  {
                    label: "Request ID",
                    value: <IdText value={entry.requestId} />,
                  },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                The route is the gateway&apos;s route template. Request and response bodies, query strings, headers and keys are never recorded. Quote the
                correlation ID when you ask for help.
              </p>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
