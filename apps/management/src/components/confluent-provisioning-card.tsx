"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  CloudUploadIcon,
  DatabaseIcon,
  RadioTowerIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  getConfluentPipelineStatus,
  includeConfluentTopicInS3Sink,
  migrateLegacyTopic,
  previewConfluentS3SinkIncludeTopic,
  previewConfluentTopicProvision,
  provisionConfluentTopic,
  type OperationPreview,
} from "@/lib/api-center-client";
import { getServiceEventTopics, type ServiceTopicType } from "@/lib/event-topics";
import { isDataPipelineEnabled } from "@/lib/feature-flags";
import { planTopicMigration } from "@/lib/topic-migration";
import { queryKeys } from "@/lib/query-keys";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OperationPreviewPanel } from "@/components/operation-preview-panel";

const DEFAULT_RETENTION_DAYS = 7;

type TopicState = {
  topicName: string;
  created: boolean;
  existed: boolean;
  retentionMs: number;
} | null;

type SinkState = {
  connectorName: string;
  updated: boolean;
  alreadyIncluded: boolean;
  topics: string[];
} | null;

type MigrationState = {
  legacyTopic: string;
  targetTopic: string;
  oldTopicPreserved: true;
} | null;

export function ConfluentProvisioningCard({
  serviceId,
  ownerTribeId,
  serviceType = "tribe",
}: {
  serviceId: string;
  ownerTribeId?: string;
  serviceType?: ServiceTopicType;
}) {
  const dataPipelineEnabled = isDataPipelineEnabled();
  const queryClient = useQueryClient();
  const [topicState, setTopicState] = useState<TopicState>(null);
  const [sinkState, setSinkState] = useState<SinkState>(null);
  const [migrationState, setMigrationState] = useState<MigrationState>(null);
  const [topicPreview, setTopicPreview] = useState<OperationPreview | null>(null);
  const [sinkPreview, setSinkPreview] = useState<OperationPreview | null>(null);
  const [typedPhrase, setTypedPhrase] = useState("");
  const [operatorReason, setOperatorReason] = useState("");
  const topics = useMemo(
    () => getServiceEventTopics({ serviceId, ownerTribeId, serviceType }),
    [serviceId, ownerTribeId, serviceType],
  );
  const migrationPlan = useMemo(
    () => planTopicMigration({ serviceId, ownerTribeId, serviceType }),
    [serviceId, ownerTribeId, serviceType],
  );
  const topicName = topics.primary;
  const isSharedService = serviceType === "shared";
  const isLive = process.env.NEXT_PUBLIC_MANAGEMENT_ENV === "live";
  const statusQuery = useQuery({
    queryKey: queryKeys.confluentPipelineStatus(serviceId, topicName),
    queryFn: () => getConfluentPipelineStatus(serviceId, topicName),
    enabled: dataPipelineEnabled,
    retry: 1,
  });

  const refreshStatus = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.confluentPipelineStatus(serviceId, topicName),
    });
  };

  const topicMutation = useMutation({
    mutationFn: () =>
      provisionConfluentTopic({
        serviceId,
        ownerTribeId,
        topicName,
        partitions: 1,
        confirmation: {
          typedPhrase,
          reason: operatorReason,
        },
      }),
    onSuccess: async (result) => {
      setTopicState(result);
      await refreshStatus();
      toast.success(result.created ? "Confluent topic created" : "Topic exists");
    },
    onError: showMutationError(
      "Topic provisioning failed",
      "Check the local Confluent Kafka API key and topic permissions.",
    ),
  });

  const topicPreviewMutation = useMutation({
    mutationFn: () =>
      previewConfluentTopicProvision({
        serviceId,
        ownerTribeId,
        topicName,
        partitions: 1,
      }),
    onSuccess: (preview) => {
      setTopicPreview(preview);
      toast.success("Topic operation preview loaded");
    },
    onError: showMutationError(
      "Topic preview failed",
      "Check management auth and Confluent configuration.",
    ),
  });

  const sinkMutation = useMutation({
    mutationFn: () =>
      includeConfluentTopicInS3Sink({
        topicName,
        confirmation: {
          typedPhrase,
          reason: operatorReason,
        },
      }),
    onSuccess: async (result) => {
      setSinkState(result);
      await refreshStatus();
      toast.success(
        result.updated ? "S3 sink connector updated" : "S3 sink already covered",
      );
    },
    onError: showMutationError(
      "S3 sink update failed",
      "Check the local Confluent Cloud API key and connector permissions.",
    ),
  });

  const sinkPreviewMutation = useMutation({
    mutationFn: () => previewConfluentS3SinkIncludeTopic({ topicName }),
    onSuccess: (preview) => {
      setSinkPreview(preview);
      toast.success("S3 sink operation preview loaded");
    },
    onError: showMutationError(
      "S3 sink preview failed",
      "Check management auth and Confluent configuration.",
    ),
  });

  const migrationMutation = useMutation({
    mutationFn: () =>
      migrateLegacyTopic({
        serviceId,
        ownerTribeId,
        serviceType,
        confirmation: {
          typedPhrase,
          reason: operatorReason,
        },
      }),
    onSuccess: async (result) => {
      setMigrationState({
        legacyTopic: result.legacyTopic,
        targetTopic: result.targetTopic,
        oldTopicPreserved: result.oldTopicPreserved,
      });
      await refreshStatus();
      toast.success("Legacy topic upgrade prepared");
    },
    onError: showMutationError(
      "Legacy topic upgrade failed",
      "Check Confluent permissions and retry.",
    ),
  });

  if (!dataPipelineEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Data pipeline disabled</CardTitle>
          <CardDescription>
            Confluent topic and S3 Sink provisioning are disabled for this
            environment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <DatabaseIcon data-icon="inline-start" />
            <AlertTitle>Core gateway mode</AlertTitle>
            <AlertDescription>
              Registration, per-service secrets, token issuance, and proxied API calls
              remain available.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <RadioTowerIcon data-icon="inline-start" />
              Confluent data pipeline
            </CardTitle>
            <CardDescription>
              {isSharedService
                ? "Create the shared-service export topic first, then add it to the managed Confluent S3 Sink connector so sanitized platform events are exported to S3."
                : "Create the tribe event topic first, then add that topic to the managed Confluent S3 Sink connector so records are exported to S3."}
            </CardDescription>
          </div>
          <Badge variant="outline">restricted</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert>
          <DatabaseIcon data-icon="inline-start" />
          <AlertTitle>Tribes publish through API Center</AlertTitle>
          <AlertDescription>
            {isSharedService
              ? "Shared-service export topics store sanitized platform events. They are not tribe-owned event topics, and shared-service pods still do not receive Confluent credentials."
              : "Do not give tribes Confluent credentials. Their backend calls API Center; API Center publishes governed events into this topic."}
          </AlertDescription>
        </Alert>

        {!isSharedService && migrationPlan.migrationNeeded ? (
          <Alert>
            <RadioTowerIcon data-icon="inline-start" />
            <AlertTitle>Legacy topic detected</AlertTitle>
            <AlertDescription>
              {migrationPlan.legacyTopic} should move to{" "}
              {migrationPlan.targetTopic}. Upgrade creates the tribe topic, adds
              it to S3 Sink, and keeps the old topic until producers are moved.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-xs font-medium text-muted-foreground">
            {topics.primaryLabel}
          </div>
          <div className="mt-1 break-all font-mono text-sm">{topicName}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>partitions: 1</span>
            <span>retention: {DEFAULT_RETENTION_DAYS} days by default</span>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <OperationPreviewPanel
            title="Topic operation preview"
            description="Preview the Kafka topic create-or-verify operation before provisioning."
            preview={topicPreview}
            live={isLive}
            typedPhrase={typedPhrase}
            reason={operatorReason}
            previewPending={topicPreviewMutation.isPending}
            onPreview={() => topicPreviewMutation.mutate()}
            onTypedPhraseChange={setTypedPhrase}
            onReasonChange={setOperatorReason}
          />
          <OperationPreviewPanel
            title="S3 sink operation preview"
            description="Preview the managed S3 Sink connector update before adding the topic."
            preview={sinkPreview}
            live={isLive}
            typedPhrase={typedPhrase}
            reason={operatorReason}
            previewPending={sinkPreviewMutation.isPending}
            onPreview={() => sinkPreviewMutation.mutate()}
            onTypedPhraseChange={setTypedPhrase}
            onReasonChange={setOperatorReason}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {!isSharedService && migrationPlan.migrationNeeded ? (
            <PipelineStep
              title="0. Upgrade legacy topic"
              description={`Creates ${migrationPlan.targetTopic}, adds it to the S3 Sink, and preserves ${migrationPlan.legacyTopic}.`}
              status={migrationState ? "Done" : "Pending"}
            >
              <Button
                type="button"
                variant="outline"
                onClick={() => migrationMutation.mutate()}
                disabled={migrationMutation.isPending}
              >
                <RadioTowerIcon data-icon="inline-start" />
                Upgrade legacy topic
              </Button>
            </PipelineStep>
          ) : null}

          <PipelineStep
            title="1. Create or verify topic"
            description={
              isSharedService
                ? "Creates the Kafka topic that API Center publishes sanitized shared-service export events into."
                : "Creates the Kafka topic that API Center publishes tribe events into."
            }
            status={getTopicStatus(statusQuery, topicState)}
          >
            <Button
              type="button"
              onClick={() => topicMutation.mutate()}
              disabled={topicMutation.isPending}
            >
              <RadioTowerIcon data-icon="inline-start" />
              Provision topic
            </Button>
          </PipelineStep>

          <PipelineStep
            title="2. Add topic to S3 sink"
            description="Updates the existing S3 Sink connector topic list. This does not create the Kafka topic."
            status={getSinkStatus(statusQuery, sinkState)}
          >
            <Button
              type="button"
              variant="outline"
              onClick={() => sinkMutation.mutate()}
              disabled={sinkMutation.isPending}
            >
              <CloudUploadIcon data-icon="inline-start" />
              Add to S3 sink
            </Button>
          </PipelineStep>
        </div>

        {topicState ? (
          <ProvisionResult
            title="Topic result"
            detail={`${topicState.topicName} ${
              topicState.created ? "was created" : "already existed"
            }.`}
          />
        ) : null}

        {sinkState ? (
          <ProvisionResult
            title="S3 sink result"
            detail={`${sinkState.connectorName} now covers ${sinkState.topics.length} topic(s).`}
          />
        ) : null}

        {migrationState ? (
          <ProvisionResult
            title="Legacy topic upgrade result"
            detail={`${migrationState.targetTopic} is prepared. ${migrationState.legacyTopic} was preserved for producer cutover.`}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function getTopicStatus(
  statusQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getConfluentPipelineStatus>>>>,
  topicState: TopicState,
) {
  if (statusQuery.isPending) return "Checking";
  if (statusQuery.isError) {
    return topicState ? "Done" : "Failed";
  }
  if (!statusQuery.data.topicCheckOk) return "Not checked";
  if (statusQuery.data.topicExists) return "Done";
  return "Pending";
}

function getSinkStatus(
  statusQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getConfluentPipelineStatus>>>>,
  sinkState: SinkState,
) {
  if (statusQuery.isPending) return "Checking";
  if (statusQuery.isError) {
    return sinkState ? "Done" : "Failed";
  }
  if (!statusQuery.data.s3SinkCheckOk) return "Not checked";
  if (statusQuery.data.s3SinkIncludesTopic) return "Done";
  return "Pending";
}

function PipelineStep({
  title,
  description,
  status,
  children,
}: {
  title: string;
  description: string;
  status: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-44 flex-col justify-between gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium">{title}</div>
          <Badge variant="secondary">{status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

function ProvisionResult({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <Alert>
      <CheckCircle2Icon data-icon="inline-start" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{detail}</AlertDescription>
    </Alert>
  );
}

function showMutationError(title: string, description: string) {
  return (error: unknown) => {
    toast.error(title, {
      description: error instanceof Error ? error.message : description,
    });
  };
}
