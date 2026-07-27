"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, CheckCircle2Icon, RefreshCwIcon } from "lucide-react";
import { getConfluentPipelineStatus } from "@/lib/api-center-client";
import { getServiceEventTopics, type ServiceTopicType } from "@/lib/event-topics";
import { isDataPipelineEnabled } from "@/lib/feature-flags";
import { queryKeys } from "@/lib/query-keys";
import type { ConfluentPipelineStatusResponse } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const EXPECTED_PARTITIONS = "1";
const EXPECTED_RETENTION = "7 days by default";

type PipelineStatus = ConfluentPipelineStatusResponse["data"];

export function ConfluentPipelineStatusPanel({
  serviceId,
  ownerTribeId,
  serviceType = "tribe",
}: {
  serviceId: string;
  ownerTribeId?: string;
  serviceType?: ServiceTopicType;
}) {
  const dataPipelineEnabled = isDataPipelineEnabled();
  const topics = useMemo(
    () => getServiceEventTopics({ serviceId, ownerTribeId, serviceType }),
    [serviceId, ownerTribeId, serviceType],
  );
  const statusQuery = useQuery({
    queryKey: queryKeys.confluentPipelineStatus(serviceId, topics.primary),
    queryFn: () => getConfluentPipelineStatus(serviceId, topics.primary),
    enabled: dataPipelineEnabled,
    retry: 1,
  });

  if (!dataPipelineEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Data pipeline disabled</CardTitle>
          <CardDescription>
            Confluent topic, S3 Sink, and raw export checks are disabled for
            this environment.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const driftStates = statusQuery.data
    ? getConfluentPipelineDriftStates(statusQuery.data)
    : statusQuery.isError
      ? ["connector unavailable"]
      : ["checking"];

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Pipeline status</CardTitle>
          <CardDescription>
            Read-only topic and S3 sink visibility for this service export path.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => statusQuery.refetch()}
          disabled={statusQuery.isFetching}
        >
          <RefreshCwIcon
            data-icon="inline-start"
            className={statusQuery.isFetching ? "animate-spin" : undefined}
          />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <StatusItem label="Expected topic" value={topics.primary} />
          <StatusItem label="Partitions" value={EXPECTED_PARTITIONS} />
          <StatusItem label="Retention" value={EXPECTED_RETENTION} />
          <StatusItem
            label="Topic exists"
            value={formatBoolean(statusQuery.data?.topicExists)}
          />
          <StatusItem
            label="S3 connector"
            value={statusQuery.data?.connectorName ?? "checking"}
          />
          <StatusItem
            label="Topic included in connector"
            value={formatBoolean(statusQuery.data?.s3SinkIncludesTopic)}
          />
          <StatusItem
            label="Connector status"
            value={getConnectorStatus(statusQuery)}
          />
          <StatusItem
            label="Last connector check"
            value={
              statusQuery.dataUpdatedAt
                ? new Date(statusQuery.dataUpdatedAt).toLocaleString()
                : "not checked"
            }
          />
          <StatusItem
            label="Last connector update"
            value="not exposed by Confluent config API"
          />
        </div>

        <div className="rounded-lg border bg-muted/25 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            {driftStates.length === 1 && driftStates[0] === "in sync" ? (
              <CheckCircle2Icon data-icon="inline-start" />
            ) : (
              <AlertTriangleIcon data-icon="inline-start" />
            )}
            Drift state
          </div>
          <div className="flex flex-wrap gap-2">
            {driftStates.map((state) => (
              <Badge
                key={state}
                variant={state === "in sync" ? "secondary" : "destructive"}
              >
                {state}
              </Badge>
            ))}
          </div>
          {statusQuery.data?.topicCheckError ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Topic check: {statusQuery.data.topicCheckError}
            </p>
          ) : null}
          {statusQuery.data?.s3SinkCheckError ? (
            <p className="mt-2 text-sm text-muted-foreground">
              S3 sink check: {statusQuery.data.s3SinkCheckError}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function getConfluentPipelineDriftStates(status: PipelineStatus) {
  const states: string[] = [];
  const expectedPrefix = process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX?.trim();
  const unprefixedTopic = stripTopicPrefix(status.topicName, expectedPrefix);

  if (!status.topicCheckOk) states.push("topic check unavailable");
  if (!status.s3SinkCheckOk) states.push("connector unavailable");
  if (status.topicCheckOk && !status.topicExists) states.push("topic missing");
  if (
    status.topicCheckOk &&
    status.s3SinkCheckOk &&
    status.topicExists &&
    !status.s3SinkIncludesTopic
  ) {
    states.push("topic exists but not in sink");
  }
  if (
    status.topicCheckOk &&
    status.s3SinkCheckOk &&
    !status.topicExists &&
    status.s3SinkIncludesTopic
  ) {
    states.push("sink includes topic but topic missing");
  }
  if (
    expectedPrefix &&
    status.topics.includes(unprefixedTopic) &&
    !status.topics.includes(status.topicName)
  ) {
    states.push("wrong prefix for environment");
  }

  return states.length ? states : ["in sync"];
}

function stripTopicPrefix(topicName: string, prefix: string | undefined) {
  if (!prefix) return topicName;
  const normalized = prefix.replace(/\.+$/, "");
  return topicName.startsWith(`${normalized}.`)
    ? topicName.slice(normalized.length + 1)
    : topicName;
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3 text-sm">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 break-all font-mono">{value}</div>
    </div>
  );
}

function formatBoolean(value: boolean | undefined) {
  if (typeof value !== "boolean") return "checking";
  return value ? "yes" : "no";
}

function getConnectorStatus(
  statusQuery: ReturnType<typeof useQuery<PipelineStatus>>,
) {
  if (statusQuery.isPending || statusQuery.isFetching) return "checking";
  if (statusQuery.isError || statusQuery.data?.s3SinkCheckOk === false) {
    return "unavailable";
  }
  return "reachable";
}
