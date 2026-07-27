"use client";

import Link from "next/link";
import { AlertTriangleIcon, ActivityIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getGatewayTraffic } from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function GatewayTrafficSummary() {
  const window = "24h";
  const query = useQuery({
    queryKey: queryKeys.gatewayTraffic(window),
    queryFn: () => getGatewayTraffic(window),
    retry: 1,
  });

  if (query.isLoading) {
    return <Skeleton className="h-40 rounded-xl" />;
  }

  if (query.isError || !query.data) {
    return (
      <Alert>
        <AlertTitle>Gateway traffic analytics unavailable</AlertTitle>
        <AlertDescription>
          Deploy the API Center analytics endpoint to show runtime proxy,
          Kafka, and readiness signals here.
        </AlertDescription>
      </Alert>
    );
  }

  const data = query.data;
  const warning = data.kafkaPublishFailures > 0 || data.readinessFailures > 0;

  return (
    <Card className={warning ? "border-destructive/30 bg-[#fff7f7]" : ""}>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Gateway traffic</CardTitle>
          <CardDescription>
            Proxy, Kafka, and readiness signals over the last {window}.
          </CardDescription>
        </div>
        <Link
          href="/alerts"
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          View alerts
        </Link>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Metric label="Proxy requests" value={data.totalProxyRequests} />
        <Metric label="Tribe to tribe" value={data.tribeToTribeRequests} />
        <Metric label="Tribe to shared" value={data.tribeToSharedRequests} />
        <Metric label="4xx" value={data.status4xx} attention={data.status4xx > 0} />
        <Metric label="5xx" value={data.status5xx} attention={data.status5xx > 0} />
        <Metric
          label="Kafka failures"
          value={data.kafkaPublishFailures}
          attention={data.kafkaPublishFailures > 0}
        />
        <Metric
          label="Readiness failures"
          value={data.readinessFailures}
          attention={data.readinessFailures > 0}
        />
        <Metric label="P95 latency" value={`${data.p95LatencyMs}ms`} />
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  attention,
}: {
  label: string;
  value: number | string;
  attention?: boolean;
}) {
  return (
    <div className={cn("rounded-lg border p-3", attention && "border-destructive/30 bg-background")}>
      <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
        {attention ? (
          <AlertTriangleIcon data-icon="inline-start" className="text-destructive" />
        ) : (
          <ActivityIcon data-icon="inline-start" />
        )}
        {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

