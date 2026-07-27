"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EyeIcon, GitBranchIcon } from "lucide-react";
import { listServices } from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import { getDependencyRows } from "@/lib/registry-view";
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
import type { ServiceRegistryEntry } from "@/lib/schemas";

type DependencyRow = ReturnType<typeof getDependencyRows>[number];

export function DependencyMapClient() {
  const [selectedDependencyKey, setSelectedDependencyKey] = useState<string>();
  const servicesQuery = useQuery({
    queryKey: queryKeys.services,
    queryFn: listServices,
  });

  if (servicesQuery.isLoading) {
    return <Skeleton className="h-80 w-full" />;
  }

  if (servicesQuery.isError || !servicesQuery.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load dependencies</AlertTitle>
        <AlertDescription>
          Check API Center connectivity and the platform secret server setting.
        </AlertDescription>
      </Alert>
    );
  }

  const rows = getDependencyRows(servicesQuery.data);
  const orderedRows = [...rows].sort(compareDependencyRows);
  const servicesById = new Map(
    servicesQuery.data.map((service) => [service.serviceId, service]),
  );
  const selectedRow =
    orderedRows.find((row) => dependencyKey(row) === selectedDependencyKey) ??
    orderedRows[0];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <GitBranchIcon data-icon="inline-start" />
              Dependency map
            </CardTitle>
            <CardDescription>
              Service-to-service permissions from each manifest `consumes` list.
            </CardDescription>
          </div>
          <CardDescription>
            {rows.length
              ? `${rows.filter((row) => row.targetStatus === "missing").length} missing target${rows.filter((row) => row.targetStatus === "missing").length === 1 ? "" : "s"}`
              : "No declared relationships"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rows.length ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.8fr)]">
              <div className="overflow-hidden rounded-lg border">
                <div className="hidden grid-cols-[minmax(10rem,0.8fr)_minmax(10rem,0.8fr)_7rem_7rem_2.25rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
                  <span>Source</span>
                  <span>Target</span>
                  <span>Type</span>
                  <span>Status</span>
                  <span className="sr-only">Inspect</span>
                </div>
                <div className="divide-y">
                  {orderedRows.map((row) => (
                    <DependencyReviewRow
                      key={dependencyKey(row)}
                      row={row}
                      selected={dependencyKey(row) === dependencyKey(selectedRow)}
                      onSelect={() => setSelectedDependencyKey(dependencyKey(row))}
                    />
                  ))}
                </div>
              </div>
              {selectedRow ? (
                <DependencyDetail
                  row={selectedRow}
                  sourceService={servicesById.get(selectedRow.sourceServiceId)}
                  targetService={servicesById.get(selectedRow.targetServiceId)}
                />
              ) : null}
            </div>
          ) : (
            <Alert>
              <AlertTitle>No dependencies declared</AlertTitle>
              <AlertDescription>
                Add consumed service IDs to manifests to populate this map.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DependencyReviewRow({
  row,
  selected,
  onSelect,
}: {
  row: DependencyRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const missing = row.targetStatus === "missing";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 md:grid-cols-[minmax(10rem,0.8fr)_minmax(10rem,0.8fr)_7rem_7rem_2.25rem] md:items-center">
      <div className="min-w-0">
        <Button
          nativeButton={false}
          variant="link"
          className="h-auto justify-start px-0 py-0 text-sm"
          render={<Link href={serviceDependencyHref(row.sourceServiceId)} />}
        >
          <span className="truncate">{row.sourceServiceId}</span>
        </Button>
        <div className="text-xs text-muted-foreground">source service</div>
      </div>
      <div className="col-start-1 min-w-0 md:col-auto">
        {missing ? (
          <div className="truncate font-medium">{row.targetServiceId}</div>
        ) : (
          <Link
            href={serviceDependencyHref(row.targetServiceId)}
            className="truncate font-medium underline-offset-4 hover:underline"
          >
            {row.targetServiceId}
          </Link>
        )}
        <div className="text-xs text-muted-foreground">consumed service</div>
      </div>
      <div className="col-start-1 md:col-auto">
        <Badge variant="outline">{row.targetType}</Badge>
      </div>
      <div className="col-start-1 md:col-auto">
        <Badge variant={missing ? "destructive" : "secondary"}>
          {dependencyStatus(row)}
        </Badge>
      </div>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect dependency ${row.sourceServiceId} to ${row.targetServiceId}`}
        title={`Inspect dependency ${row.sourceServiceId} to ${row.targetServiceId}`}
        onClick={onSelect}
        className="col-start-2 row-start-1 inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground md:col-auto md:row-auto"
      >
        <EyeIcon data-icon="inline-end" />
      </button>
    </div>
  );
}

function DependencyDetail({
  row,
  sourceService,
  targetService,
}: {
  row: DependencyRow;
  sourceService?: ServiceRegistryEntry;
  targetService?: ServiceRegistryEntry;
}) {
  const missing = row.targetStatus === "missing";
  const action = missing
    ? {
        label: "Update the source service manifest.",
        href: `/tribes/${row.sourceServiceId}/edit`,
      }
    : {
        label: "Open the target service record.",
        href: serviceDependencyHref(row.targetServiceId),
      };

  return (
    <aside
      aria-label="Selected dependency detail"
      className="order-first rounded-lg border bg-muted/10 p-4 xl:order-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Selected dependency</div>
          <div className="mt-1 truncate text-base font-medium">
            {row.sourceServiceId} to {row.targetServiceId}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {sourceService?.name ?? row.sourceServiceId} consumes{" "}
            {targetService?.name ?? row.targetServiceId}
          </div>
        </div>
        <Badge variant={missing ? "destructive" : "secondary"}>
          {dependencyStatus(row)}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 border-t pt-4 text-xs sm:grid-cols-2">
        <DetailSignal label="Source service" value={row.sourceServiceId} />
        <DetailSignal label="Target service" value={row.targetServiceId} />
        <DetailSignal label="Target type" value={row.targetType} />
        <DetailSignal label="Target status" value={row.targetStatus} />
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">Evidence</div>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {dependencyEvidence(row)}
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
          <GitBranchIcon data-icon="inline-end" />
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

function compareDependencyRows(left: DependencyRow, right: DependencyRow) {
  const rankDelta = dependencyRank(left) - dependencyRank(right);
  if (rankDelta !== 0) return rankDelta;
  return dependencyKey(left).localeCompare(dependencyKey(right));
}

function dependencyRank(row: DependencyRow) {
  if (row.targetStatus === "missing") return 0;
  if (row.targetStatus === "deprecated" || row.targetStatus === "retired") {
    return 1;
  }
  return 2;
}

function dependencyStatus(row: DependencyRow) {
  if (row.targetStatus === "missing") return "missing";
  if (row.targetStatus === "deprecated" || row.targetStatus === "retired") {
    return "attention";
  }
  return "registered";
}

function dependencyEvidence(row: DependencyRow) {
  if (row.targetStatus === "missing") {
    return `${row.targetServiceId} is not registered in APICenter.`;
  }
  return `${row.targetServiceId} is registered as a ${row.targetType} service.`;
}

function dependencyKey(row: DependencyRow) {
  return `${row.sourceServiceId}:${row.targetServiceId}`;
}

function serviceDependencyHref(serviceId: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=dependencies`;
}
