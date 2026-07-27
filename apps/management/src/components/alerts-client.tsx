"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOperationalAlerts } from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import type { SharedServiceUsageWindow } from "@/lib/schemas";
import { EmptyDataState, SetupRequiredState } from "@/components/query-state";
import { TimeWindowSelector } from "@/components/time-window-selector";
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

export function AlertsClient() {
  const [window, setWindow] = useState<SharedServiceUsageWindow>("1h");
  const query = useQuery({
    queryKey: queryKeys.operationalAlerts(window),
    queryFn: () => getOperationalAlerts(window),
    retry: 1,
  });

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Operational alerts</CardTitle>
          <CardDescription>
            Read-only alerts derived from registry metadata and runtime counters.
          </CardDescription>
        </div>
        <TimeWindowSelector value={window} onChange={setWindow} />
      </CardHeader>
      <CardContent>
        {query.isError ? (
          <SetupRequiredState
            title="Alerts endpoint unavailable"
            description="Deploy API Center analytics before using this alerts view."
          />
        ) : query.data?.length ? (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Recommended fix</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <Badge variant={alert.severity === "error" ? "destructive" : "secondary"}>
                        {alert.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{alert.type}</TableCell>
                    <TableCell>
                      {alert.serviceId ? (
                        <Link
                          href={serviceDetailHref(alert.serviceId, "health")}
                          className="underline-offset-4 hover:underline"
                        >
                          {alert.serviceId}
                        </Link>
                      ) : (
                        "System"
                      )}
                    </TableCell>
                    <TableCell>{alert.message}</TableCell>
                    <TableCell>{alert.recommendation}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {getAlertActions(alert.type, alert.serviceId).map(
                          (action) => (
                            <Link
                              key={`${alert.id}-${action.label}-${action.href}`}
                              href={action.href}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {action.label}
                            </Link>
                          ),
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyDataState
            title="No active alerts"
            description="No alert rules are firing for the selected window. Treat this as a quiet state only after the source feeds have been checked."
            recoverySteps={[
              {
                label: "Verify analytics ingestion",
                description:
                  "Confirm runtime counters are landing for the selected time window.",
              },
              {
                label: "Open runtime evidence",
                description:
                  "Use service health or shared-service usage to verify the monitored source before closing the queue.",
              },
              {
                label: "Refresh the selected window",
                description:
                  "Change the alert window or refresh after new runtime data arrives.",
              },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

function getAlertActions(type: string, serviceId?: string) {
  const normalizedType = type.toLowerCase();
  const actions: Array<{ href: string; label: string }> = [];

  if (serviceId) {
    actions.push({
      href: serviceDetailHref(serviceId, "health"),
      label: "Service",
    });
    actions.push({
      href: serviceDetailHref(serviceId, "evidence"),
      label: "Audit",
    });
  }

  if (
    normalizedType.includes("usage") ||
    normalizedType.includes("latency") ||
    normalizedType.includes("error-rate")
  ) {
    actions.push({
      href: serviceId
        ? serviceDetailHref(serviceId, "dependencies")
        : "/shared-services/usage",
      label: "Usage",
    });
  }

  if (serviceId === "payment" || normalizedType.includes("payment")) {
    actions.push({ href: "/smoke-tests?tribeId=smoke-tribe", label: "Payment smoke" });
    actions.push({
      href: serviceDetailHref(serviceId ?? "payment", "dependencies"),
      label: "Payment usage",
    });
  }

  if (normalizedType.includes("readiness")) {
    actions.push({ href: "/readiness", label: "Readiness" });
  }

  if (normalizedType.includes("kafka")) {
    actions.push({ href: "/settings", label: "Settings" });
  }

  return actions.length ? actions : [{ href: "/alerts", label: "Open" }];
}

function serviceDetailHref(serviceId: string, section: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=${encodeURIComponent(section)}`;
}
