"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, CheckCircleIcon, MinusCircleIcon } from "lucide-react";
import { getSharedServiceRuntimeUsage } from "@/lib/api-center-client";
import { expectedSharedServiceIds } from "@/lib/shared-service-usage";
import { queryKeys } from "@/lib/query-keys";
import type {
  ServiceRegistryEntry,
  SharedServiceUsageWindow,
} from "@/lib/schemas";
import { TimeWindowSelector } from "@/components/time-window-selector";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  formatLastUsed,
  formatPercent,
  getRuntimeForTribe,
  getSharedServiceName,
} from "@/components/observability-utils";

export function TribeObservabilityPanel({
  service,
  services,
}: {
  service: ServiceRegistryEntry;
  services: ServiceRegistryEntry[];
}) {
  const [window, setWindow] = useState<SharedServiceUsageWindow>("24h");
  const runtimeUsageQuery = useQuery({
    queryKey: queryKeys.sharedServiceUsage(window),
    queryFn: () => getSharedServiceRuntimeUsage(window),
    retry: 1,
  });

  const runtimeRows = getRuntimeForTribe(
    runtimeUsageQuery.data ?? [],
    service.serviceId,
  );
  const declaredIds = service.consumes.filter((serviceId) =>
    expectedSharedServiceIds.includes(serviceId),
  );
  const runtimeIds = new Set(runtimeRows.map((usage) => usage.sharedServiceId));
  const declaredRuntimeRows = declaredIds.map((sharedServiceId) => ({
    sharedServiceId,
    runtime: runtimeRows.find(
      (usage) => usage.sharedServiceId === sharedServiceId,
    ),
    declared: true,
  }));
  const undeclaredRuntimeRows = runtimeRows
    .filter((usage) => !declaredIds.includes(usage.sharedServiceId))
    .map((runtime) => ({
      sharedServiceId: runtime.sharedServiceId,
      runtime,
      declared: false,
    }));
  const rows = [...declaredRuntimeRows, ...undeclaredRuntimeRows];
  const failedCalls = runtimeRows.reduce(
    (sum, usage) => sum + usage.failedRequests,
    0,
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Tribe observability</CardTitle>
          <CardDescription>
            Declared shared-service dependencies compared with runtime calls.
          </CardDescription>
        </div>
        <TimeWindowSelector value={window} onChange={setWindow} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Signal label="Declared shared services" value={declaredIds.length} />
          <Signal label="Used in window" value={runtimeIds.size} />
          <Signal
            label="Undeclared runtime use"
            value={undeclaredRuntimeRows.length}
            attention={undeclaredRuntimeRows.length > 0}
          />
          <Signal label="Failed calls" value={failedCalls} attention={failedCalls > 0} />
        </div>

        {runtimeUsageQuery.isError ? (
          <Alert>
            <AlertTitle>Runtime analytics unavailable</AlertTitle>
            <AlertDescription>
              Registry declarations are still visible. Deploy the API Center
              analytics endpoint to show live usage and failures.
            </AlertDescription>
          </Alert>
        ) : null}

        {rows.length ? (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shared service</TableHead>
                  <TableHead>Calls</TableHead>
                  <TableHead>Errors</TableHead>
                  <TableHead>Avg latency</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Declared</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.sharedServiceId}>
                    <TableCell>
                      <Link
                        className="font-medium underline-offset-4 hover:underline"
                        href={`/tribes/${row.sharedServiceId}`}
                      >
                        {getSharedServiceName(services, row.sharedServiceId)}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">
                        {row.sharedServiceId}
                      </div>
                    </TableCell>
                    <TableCell>{row.runtime?.totalRequests ?? 0}</TableCell>
                    <TableCell>
                      {row.runtime
                        ? `${row.runtime.failedRequests} (${formatPercent(row.runtime.errorRate)})`
                        : "0"}
                    </TableCell>
                    <TableCell>{row.runtime?.avgLatencyMs ?? 0}ms</TableCell>
                    <TableCell>{formatLastUsed(row.runtime?.lastUsedAt)}</TableCell>
                    <TableCell>
                      <UsageBadge declared={row.declared} used={Boolean(row.runtime)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Alert>
            <AlertTitle>No shared-service usage configured</AlertTitle>
            <AlertDescription>
              This tribe does not declare any platform shared services yet.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function Signal({
  label,
  value,
  attention,
}: {
  label: string;
  value: number;
  attention?: boolean;
}) {
  return (
    <div className={cn("rounded-lg border p-4", attention && "border-destructive/30 bg-[#fff7f7]")}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function UsageBadge({ declared, used }: { declared: boolean; used: boolean }) {
  if (declared && used) {
    return (
      <Badge className="bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]">
        <CheckCircleIcon data-icon="inline-start" />
        Declared and used
      </Badge>
    );
  }
  if (declared) {
    return (
      <Badge variant="secondary">
        <MinusCircleIcon data-icon="inline-start" />
        Declared
      </Badge>
    );
  }
  return (
    <Badge className="bg-[#fff7f7] text-destructive">
      <AlertTriangleIcon data-icon="inline-start" />
      Undeclared
    </Badge>
  );
}
