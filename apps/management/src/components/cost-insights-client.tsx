"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getProviderUsage, getQuotaUsage } from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import type { SharedServiceUsageWindow } from "@/lib/schemas";
import { EmptyDataState, SetupRequiredState } from "@/components/query-state";
import { TimeWindowSelector } from "@/components/time-window-selector";
import { TribeCostAndQuotaPanel } from "@/components/tribe-cost-and-quota-panel";
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

export function CostInsightsClient() {
  const [window, setWindow] = useState<SharedServiceUsageWindow>("24h");
  const query = useQuery({
    queryKey: queryKeys.providerUsage(window),
    queryFn: () => getProviderUsage(window),
    retry: 1,
  });
  const quotaUsageQuery = useQuery({
    queryKey: queryKeys.quotaUsage("all", window),
    queryFn: () => getQuotaUsage({ window }),
    retry: 1,
  });
  const quotaPressure = (quotaUsageQuery.data ?? []).reduce(
    (summary, row) => {
      const usagePercent = (row.requestCount / row.maxRequests) * 100;
      return {
        totalCost:
          summary.totalCost + (row.estimatedChargeback?.totalCost ?? 0),
        quotaUsagePercent: Math.max(summary.quotaUsagePercent, usagePercent),
      };
    },
    { totalCost: 0, quotaUsagePercent: 0 },
  );

  return (
    <div className="flex flex-col gap-4">
      <TribeCostAndQuotaPanel
        totalCost={quotaPressure.totalCost}
        quotaUsagePercent={quotaPressure.quotaUsagePercent}
      />
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Provider usage</CardTitle>
            <CardDescription>
              Shared-service calls that can drive provider cost.
            </CardDescription>
          </div>
          <TimeWindowSelector value={window} onChange={setWindow} />
        </CardHeader>
        <CardContent>
          {query.isError ? (
            <SetupRequiredState
              title="Provider usage endpoint unavailable"
              description="Deploy API Center analytics before using this cost view."
            />
          ) : query.data?.length ? (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shared service</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Calls</TableHead>
                    <TableHead>Failures</TableHead>
                    <TableHead>Tribes</TableHead>
                    <TableHead>Avg latency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.map((row) => (
                    <TableRow key={row.sharedServiceId}>
                      <TableCell className="font-mono">
                        {row.sharedServiceId}
                      </TableCell>
                      <TableCell>{row.provider}</TableCell>
                      <TableCell>{row.totalRequests}</TableCell>
                      <TableCell>
                        {row.failedRequests} ({(row.errorRate * 100).toFixed(1)}
                        %)
                      </TableCell>
                      <TableCell>{row.tribeCount}</TableCell>
                      <TableCell>{row.avgLatencyMs}ms</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyDataState
              title="No provider usage recorded"
              description="Shared-service runtime calls will appear here after traffic reaches API Center."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
