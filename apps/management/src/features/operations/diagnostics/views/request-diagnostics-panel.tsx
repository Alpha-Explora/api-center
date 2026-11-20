"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IdText } from "@/components/patterns/copy-button";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorPanel } from "@/components/patterns/notices";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDateTime } from "@/lib/format";
import { loadRequests } from "../data/diagnostics-repository";

/** Platform lookup of a gateway request by the correlation ID returned with its response. */
export function RequestDiagnosticsPanel() {
  const [input, setInput] = useState("");
  const [correlationId, setCorrelationId] = useState("");
  const records = useQuery({
    queryKey: ["request-diagnostics", correlationId],
    queryFn: () => loadRequests(correlationId),
    enabled: Boolean(correlationId),
  });

  return (
    <Panel
      title="Find a request"
      description="Requests from the last 24 hours that failed before a key was verified. Unverified keys are never used to guess who sent them."
      flush
    >
      <form
        className="flex flex-col gap-2 border-b p-4 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          setCorrelationId(input.trim());
        }}
      >
        <Input
          aria-label="Correlation ID"
          className="font-mono sm:max-w-md"
          placeholder="Correlation ID from the response"
          value={input}
          maxLength={128}
          onChange={(event) => setInput(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!input.trim()}>
          <SearchIcon data-icon="inline-start" /> Find
        </Button>
      </form>
      {!correlationId ? (
        <EmptyState title="Enter a correlation ID" description="Every gateway response carries one; paste it to see where the request failed." />
      ) : records.isPending ? (
        <div className="p-4" role="status">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : records.error ? (
        <div className="p-4">
          <ErrorPanel title="Request diagnostics are unavailable" error={records.error} />
        </div>
      ) : !records.data?.length ? (
        <EmptyState title="No matching requests" description="Nothing with that correlation ID in the last 24 hours." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Request</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Failed at</TableHead>
              <TableHead className="hidden md:table-cell">When</TableHead>
              <TableHead className="hidden lg:table-cell">Correlation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.data.map((record) => (
              <TableRow key={record.requestId}>
                <TableCell className="font-mono text-xs">
                  {record.method} {record.route}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={record.statusCode >= 500 ? "danger" : record.statusCode >= 400 ? "warning" : "success"}>{record.statusCode}</StatusBadge>
                  {record.errorCode ? <span className="ml-2 font-mono text-xs text-muted-foreground">{record.errorCode}</span> : null}
                </TableCell>
                <TableCell>{record.failureStage ?? "—"}</TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {formatDateTime(record.occurredAt)} · {record.durationMs} ms
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <IdText value={record.correlationId} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
