"use client";

import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getOperationalAlerts } from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function DashboardAlertStrip() {
  const window = "1h";
  const query = useQuery({
    queryKey: queryKeys.operationalAlerts(window),
    queryFn: () => getOperationalAlerts(window),
    retry: 1,
  });

  const errorCount =
    query.data?.filter((alert) => alert.severity === "error").length ?? 0;
  const warningCount =
    query.data?.filter((alert) => alert.severity === "warning").length ?? 0;

  if (query.isError || !query.data?.length) return null;

  const firstAlert = query.data[0];
  const firstAlertHref = firstAlert.serviceId
    ? `/tribes/${encodeURIComponent(firstAlert.serviceId)}?section=health`
    : "/alerts";

  return (
    <Alert variant={errorCount > 0 ? "destructive" : "default"}>
      <AlertTriangleIcon data-icon="inline-start" />
      <AlertTitle>
        {query.data.length} active alert{query.data.length === 1 ? "" : "s"}
      </AlertTitle>
      <AlertDescription>
        {errorCount} error, {warningCount} warning in the last {window}.{" "}
        <Link href="/alerts" className="font-medium underline-offset-4 hover:underline">
          Review alerts
        </Link>{" "}
        or{" "}
        <Link
          href={firstAlertHref}
          className="font-medium underline-offset-4 hover:underline"
        >
          open first issue
        </Link>
      </AlertDescription>
    </Alert>
  );
}
