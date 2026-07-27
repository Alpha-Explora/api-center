"use client";

import { LoaderCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import type { PipelineAthenaCostRow } from "@/lib/schemas";

export function DataPipelineCostPanel({
  rows = [],
  loading = false,
  scopeLabel = "Workgroup scan volume from APICenter query-execution telemetry.",
}: {
  rows?: PipelineAthenaCostRow[];
  loading?: boolean;
  scopeLabel?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Athena query cost</CardTitle>
        <CardDescription>{scopeLabel}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <Alert>
            <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
            <AlertTitle>Loading query cost</AlertTitle>
            <AlertDescription>
              Reading Gold Athena query-cost output.
            </AlertDescription>
          </Alert>
        ) : null}

        {!loading && !rows.length ? (
          <Alert>
            <AlertTitle>No Athena cost rows yet</AlertTitle>
            <AlertDescription>
              Cost rows require APICenter Athena query-execution events. The view
              stays empty until those telemetry events are exported.
            </AlertDescription>
          </Alert>
        ) : null}

        {rows.length ? (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workgroup</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Queries</TableHead>
                  <TableHead>Scanned</TableHead>
                  <TableHead>Estimated cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={[
                      row.environment,
                      row.workgroup,
                      row.resultPurpose,
                      row.eventDay,
                    ].join(":")}
                  >
                    <TableCell className="font-mono text-xs">{row.workgroup}</TableCell>
                    <TableCell>{row.resultPurpose}</TableCell>
                    <TableCell>{row.eventDay}</TableCell>
                    <TableCell>{row.queryCount}</TableCell>
                    <TableCell>{formatBytes(row.bytesScanned)}</TableCell>
                    <TableCell>${row.estimatedCostUsd.toFixed(6)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatBytes(value: number) {
  if (value >= 1024 ** 4) return `${(value / 1024 ** 4).toFixed(2)} TiB`;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KiB`;
  return `${value} B`;
}
