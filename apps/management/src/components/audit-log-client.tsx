"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuditEvents } from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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

export function AuditLogClient({
  defaultActionFamily = "",
  defaultServiceId = "",
  defaultType = "",
}: {
  defaultActionFamily?: string;
  defaultServiceId?: string;
  defaultType?: string;
}) {
  const [serviceId, setServiceId] = useState(defaultServiceId);
  const [type, setType] = useState(defaultType);
  const [actionFamily, setActionFamily] = useState(defaultActionFamily);
  const [actor, setActor] = useState("");
  const filterKey = useMemo(
    () => JSON.stringify({ serviceId, type, actionFamily, actor }),
    [serviceId, type, actionFamily, actor],
  );
  const exportHref = useMemo(() => {
    const params = new URLSearchParams({ format: "csv" });
    if (serviceId) params.set("serviceId", serviceId);
    if (type) params.set("type", type);
    if (actionFamily) params.set("actionFamily", actionFamily);
    if (actor) params.set("actor", actor);
    return `/api/local/audit/events?${params.toString()}`;
  }, [serviceId, type, actionFamily, actor]);
  const query = useQuery({
    queryKey: queryKeys.auditEvents(filterKey),
    queryFn: () =>
      getAuditEvents({
        limit: 100,
        serviceId: serviceId || undefined,
        type: type || undefined,
        actionFamily: actionFamily || undefined,
        actor: actor || undefined,
      }),
    retry: 1,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit events</CardTitle>
        <CardDescription>
          Recent registry, proxy, Kafka, and readiness events captured by API
          Center.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-5">
          <Input
            aria-label="Filter by service ID"
            placeholder="Filter by service ID"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
          />
          <Input
            aria-label="Filter by event type"
            placeholder="Filter by event type"
            value={type}
            onChange={(event) => setType(event.target.value)}
          />
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={actionFamily}
            onChange={(event) => setActionFamily(event.target.value)}
            aria-label="Filter by action family"
          >
            <option value="">All action families</option>
            {[
              "quota",
              "plan",
              "approval",
              "promotion",
              "secret",
              "policy",
              "runtime",
            ].map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
          <Input
            aria-label="Filter by actor"
            placeholder="Filter by actor"
            value={actor}
            onChange={(event) => setActor(event.target.value)}
          />
          <Link
            href={exportHref}
            className="inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium"
          >
            Export CSV
          </Link>
        </div>

        {query.isError ? (
          <Alert>
            <AlertTitle>Audit endpoint unavailable</AlertTitle>
            <AlertDescription>
              Deploy the API Center analytics endpoint to inspect recent events.
            </AlertDescription>
          </Alert>
        ) : null}

        {query.data?.length ? (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Family</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(event.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {event.type}
                    </TableCell>
                    <TableCell>{event.actionFamily ?? "-"}</TableCell>
                    <TableCell>{event.actor ?? "-"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          event.severity === "error"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {event.severity}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {event.serviceId ? (
                        <Link
                          href={`/tribes/${encodeURIComponent(event.serviceId)}?section=evidence`}
                          className="underline-offset-4 hover:underline"
                        >
                          {event.serviceId}
                        </Link>
                      ) : (
                        "System"
                      )}
                    </TableCell>
                    <TableCell>{event.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Alert>
            <AlertTitle>No audit events</AlertTitle>
            <AlertDescription>
              No events match the current filters, or the deployed API Center
              has not recorded events yet.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
