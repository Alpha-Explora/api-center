"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, CheckCircleIcon } from "lucide-react";
import { getSharedServiceRuntimeUsage } from "@/lib/api-center-client";
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
  getRuntimeForSharedService,
  getTribeName,
  isTribeService,
} from "@/components/observability-utils";

export function SharedServiceObservabilityPanel({
  service,
  services,
  consumers,
}: {
  service: ServiceRegistryEntry;
  services: ServiceRegistryEntry[];
  consumers: string[];
}) {
  const [window, setWindow] = useState<SharedServiceUsageWindow>("24h");
  const runtimeUsageQuery = useQuery({
    queryKey: queryKeys.sharedServiceUsage(window),
    queryFn: () => getSharedServiceRuntimeUsage(window),
    retry: 1,
  });

  const runtimeRows = getRuntimeForSharedService(
    runtimeUsageQuery.data ?? [],
    service.serviceId,
  );
  const declaredConsumers = new Set(consumers);
  const runtimeConsumers = new Set(runtimeRows.map((usage) => usage.tribeServiceId));
  const totalCalls = runtimeRows.reduce((sum, usage) => sum + usage.totalRequests, 0);
  const failedCalls = runtimeRows.reduce((sum, usage) => sum + usage.failedRequests, 0);
  const latencyTotal = runtimeRows.reduce(
    (sum, usage) => sum + usage.avgLatencyMs * usage.totalRequests,
    0,
  );
  const undeclaredCallers = runtimeRows.filter(
    (usage) => !declaredConsumers.has(usage.tribeServiceId),
  );
  const declaredButUnused = consumers.filter(
    (consumer) => !runtimeConsumers.has(consumer),
  );
  const errorRate = totalCalls > 0 ? failedCalls / totalCalls : 0;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Shared-service analytics</CardTitle>
          <CardDescription>
            Consumers, live callers, failures, and setup risks for this shared service.
          </CardDescription>
        </div>
        <TimeWindowSelector value={window} onChange={setWindow} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Signal label="Declared consumers" value={consumers.length} />
          <Signal label="Runtime callers" value={runtimeConsumers.size} />
          <Signal label="Total calls" value={totalCalls} />
          <Signal label="Error rate" value={`${formatPercent(errorRate)}`} attention={errorRate >= 0.05} />
        </div>

        <div className="grid gap-3 md:grid-cols-5">
          <Risk label="Declared but unused" active={declaredButUnused.length > 0} />
          <Risk label="Used but not declared" active={undeclaredCallers.length > 0} />
          <Risk label="High error rate" active={errorRate >= 0.05} />
          <Risk label="No health path" active={!service.healthCheck} />
          <Risk label="No owner" active={!service.ownerTeam || !service.contact} />
        </div>

        {runtimeUsageQuery.isError ? (
          <Alert>
            <AlertTitle>Runtime analytics unavailable</AlertTitle>
            <AlertDescription>
              Deploy the API Center analytics endpoint to show live callers,
              error rate, and last-used timestamps.
            </AlertDescription>
          </Alert>
        ) : null}

        {runtimeRows.length || consumers.length ? (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tribe</TableHead>
                  <TableHead>Calls</TableHead>
                  <TableHead>Errors</TableHead>
                  <TableHead>Avg latency</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Relationship</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...new Set([...consumers, ...runtimeRows.map((row) => row.tribeServiceId)])].map(
                  (tribeId) => {
                    const runtime = runtimeRows.find((row) => row.tribeServiceId === tribeId);
                    const declared = declaredConsumers.has(tribeId);
                    const tribe = services.find((candidate) => candidate.serviceId === tribeId);
                    return (
                      <TableRow key={tribeId}>
                        <TableCell>
                          <Link
                            className="font-medium underline-offset-4 hover:underline"
                            href={`/tribes/${tribeId}`}
                          >
                            {getTribeName(services, tribeId)}
                          </Link>
                          <div className="font-mono text-xs text-muted-foreground">
                            {tribeId}
                          </div>
                          {tribe && !isTribeService(tribe) ? (
                            <div className="text-xs text-muted-foreground">shared service</div>
                          ) : null}
                        </TableCell>
                        <TableCell>{runtime?.totalRequests ?? 0}</TableCell>
                        <TableCell>
                          {runtime
                            ? `${runtime.failedRequests} (${formatPercent(runtime.errorRate)})`
                            : "0"}
                        </TableCell>
                        <TableCell>{runtime?.avgLatencyMs ?? 0}ms</TableCell>
                        <TableCell>{formatLastUsed(runtime?.lastUsedAt)}</TableCell>
                        <TableCell>
                          {declared ? (
                            <Badge className="bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]">
                              Declared
                            </Badge>
                          ) : (
                            <Badge className="bg-[#fff7f7] text-destructive">
                              Undeclared
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  },
                )}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Alert>
            <AlertTitle>No consumers yet</AlertTitle>
            <AlertDescription>
              No tribe manifest declares this shared service and no runtime calls
              were recorded in the selected window.
            </AlertDescription>
          </Alert>
        )}

        <div className="text-sm text-muted-foreground">
          Weighted average latency: {totalCalls > 0 ? Math.round(latencyTotal / totalCalls) : 0}ms
        </div>
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
  value: number | string;
  attention?: boolean;
}) {
  return (
    <div className={cn("rounded-lg border p-4", attention && "border-destructive/30 bg-[#fff7f7]")}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Risk({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border p-3 text-sm",
        active ? "border-destructive/30 bg-[#fff7f7] text-destructive" : "text-muted-foreground",
      )}
    >
      {active ? (
        <AlertTriangleIcon data-icon="inline-start" />
      ) : (
        <CheckCircleIcon data-icon="inline-start" />
      )}
      {label}
    </div>
  );
}
