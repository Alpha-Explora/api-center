"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  deleteTribeSecret,
  deregisterService,
  getTribeSecretStatus,
  previewConfluentS3SinkRemoveTopic,
  previewTribeSecretDelete,
  removeConfluentTopicFromS3Sink,
  type OperationPreview,
} from "@/lib/api-center-client";
import { getServiceEventTopics } from "@/lib/event-topics";
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
import { Input } from "@/components/ui/input";
import { OperationPreviewPanel } from "@/components/operation-preview-panel";
import type { ServiceRegistryEntry } from "@/lib/schemas";

type CleanupResult = {
  label: string;
  status: string;
};

type CleanupEnvironment = NonNullable<
  ServiceRegistryEntry["environments"]
>[number];

export function TribeDeprovisioningCard({
  serviceId,
  ownerTribeId,
  environments,
  onDeregistered,
}: {
  serviceId: string;
  ownerTribeId?: string;
  environments?: CleanupEnvironment[];
  onDeregistered: () => void;
}) {
  const queryClient = useQueryClient();
  const [deleteSecret, setDeleteSecret] = useState(false);
  const [removeFromSink, setRemoveFromSink] = useState(false);
  const [deregister, setDeregister] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [results, setResults] = useState<CleanupResult[]>([]);
  const [secretPreview, setSecretPreview] = useState<OperationPreview | null>(
    null,
  );
  const [sinkPreview, setSinkPreview] = useState<OperationPreview | null>(null);
  const [typedPhrase, setTypedPhrase] = useState("");
  const [operatorReason, setOperatorReason] = useState("");
  const tribePrincipalId = ownerTribeId ?? serviceId;
  const usesSharedTribeResources = tribePrincipalId !== serviceId;
  const cleanupResources = useMemo(() => {
    const serviceEnvironments =
      environments && environments.length > 0
        ? environments
        : [{ environment: "test" as const }];
    const resourcesByEnvironment = new Map<
      "test" | "live",
      {
        environment: "test" | "live";
        secretPrincipalId: string;
        secretName: string;
        topicName: string;
      }
    >();

    for (const serviceEnvironment of serviceEnvironments) {
      const environment: "test" | "live" =
        serviceEnvironment.environment === "live" ? "live" : "test";
      if (resourcesByEnvironment.has(environment)) continue;

      const secretPrincipalId = tribePrincipalId;
      const topicName = getServiceEventTopics({
        serviceId,
        ownerTribeId,
        serviceType: "tribe",
        environment,
      }).tribeEvents;

      resourcesByEnvironment.set(environment, {
        environment,
        secretPrincipalId,
        secretName: `api-center-tribe-secret-${secretPrincipalId}-${environment}`,
        topicName,
      });
    }

    return [...resourcesByEnvironment.values()];
  }, [environments, ownerTribeId, serviceId, tribePrincipalId]);
  const primaryCleanupResource = cleanupResources[0];
  const hasLiveCleanupResource = cleanupResources.some(
    (resource) => resource.environment === "live",
  );
  const secretStatusQuery = useQuery({
    queryKey: queryKeys.tribeSecretStatus(
      tribePrincipalId,
      primaryCleanupResource.environment,
    ),
    queryFn: () =>
      getTribeSecretStatus(
        tribePrincipalId,
        primaryCleanupResource.environment,
      ),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const completed: CleanupResult[] = [];

      if (deleteSecret) {
        for (const resource of cleanupResources) {
          const result = await deleteTribeSecret(resource.secretPrincipalId, {
            mode: "delete",
            environment: resource.environment,
            confirmServiceId: resource.secretPrincipalId,
            confirmation: {
              typedPhrase,
              reason: operatorReason,
            },
          });
          completed.push({
            label: `${resource.environment} credential secret`,
            status: result.action === "deleted" ? "deleted" : "not found",
          });
        }
      }

      if (removeFromSink) {
        for (const resource of cleanupResources) {
          const result = await removeConfluentTopicFromS3Sink({
            topicName: resource.topicName,
            confirmation: {
              typedPhrase,
              reason: operatorReason,
            },
          });
          completed.push({
            label: `${resource.environment} S3 sink topic`,
            status: result.removed ? "removed" : "was not included",
          });
        }
      }

      if (deregister) {
        await deregisterService(serviceId);
        completed.push({
          label: "Registry entry",
          status: "deregistered",
        });
      }

      return completed;
    },
    onSuccess: async (completed) => {
      setResults(completed);
      toast.success("Deprovisioning actions completed");
      await queryClient.invalidateQueries({ queryKey: queryKeys.services });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tribeSecretStatus(
          tribePrincipalId,
          primaryCleanupResource.environment,
        ),
      });
      if (deregister) onDeregistered();
    },
    onError: () => {
      toast.error("Deprovisioning failed", {
        description: "Check provider permissions and retry the failed action.",
      });
    },
  });
  const secretPreviewMutation = useMutation({
    mutationFn: () =>
      previewTribeSecretDelete(primaryCleanupResource.secretPrincipalId, {
        mode: "delete",
        environment: primaryCleanupResource.environment,
        confirmServiceId: primaryCleanupResource.secretPrincipalId,
      }),
    onSuccess: (preview) => {
      setSecretPreview(preview);
      toast.success("Secret cleanup preview loaded");
    },
    onError: () => {
      toast.error("Secret cleanup preview failed");
    },
  });
  const sinkPreviewMutation = useMutation({
    mutationFn: () =>
      previewConfluentS3SinkRemoveTopic({
        topicName: primaryCleanupResource.topicName,
      }),
    onSuccess: (preview) => {
      setSinkPreview(preview);
      toast.success("S3 sink cleanup preview loaded");
    },
    onError: () => {
      toast.error("S3 sink cleanup preview failed");
    },
  });

  const hasAction =
    (!usesSharedTribeResources && (deleteSecret || removeFromSink)) ||
    deregister;
  const liveConfirmed =
    !hasLiveCleanupResource ||
    (typedPhrase === "APPLY LIVE CHANGE" && operatorReason.trim().length > 0);
  const canRun =
    hasAction && confirm === serviceId && liveConfirmed && !mutation.isPending;
  const isLive = hasLiveCleanupResource;
  const secretStatus = secretStatusQuery.data?.exists
    ? secretStatusQuery.data.state || "exists"
    : "not found";

  return (
    <Card className="border-destructive/25">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Trash2Icon data-icon="inline-start" />
              Deprovision tribe
            </CardTitle>
            <CardDescription>
              Clean up external resources explicitly. Historical S3 data and
              Confluent topics are preserved.
            </CardDescription>
          </div>
          <Badge variant="outline">explicit cleanup</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert>
          <AlertTitle>Deregister is registry-only</AlertTitle>
          <AlertDescription>
            Use this panel when you also need to remove credentials or stop new
            S3 exports for this tribe.
          </AlertDescription>
        </Alert>

        {usesSharedTribeResources ? (
          <Alert>
            <AlertTitle>Shared tribe resources are preserved</AlertTitle>
            <AlertDescription>
              This service uses the {tribePrincipalId} tribe secret and topic.
              Deprovisioning this microservice should not delete those shared
              tribe resources.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 text-sm md:grid-cols-2">
          {cleanupResources.map((resource) => (
            <ResourceDetail
              key={`${resource.environment}:secret`}
              label={`${resource.environment} credential secret`}
              value={resource.secretName}
              status={secretStatusQuery.isLoading ? "checking" : secretStatus}
            />
          ))}
          {cleanupResources.map((resource) => (
            <ResourceDetail
              key={`${resource.environment}:topic`}
              label={`${resource.environment} event topic`}
              value={resource.topicName}
              status="preserved"
            />
          ))}
        </div>

        <div className="grid gap-2">
          <CleanupOption
            checked={deleteSecret}
            label="Delete tribe credential secret"
            description="Stops this tribe from requesting new API Center tokens."
            disabled={usesSharedTribeResources}
            onChange={setDeleteSecret}
          />
          <CleanupOption
            checked={removeFromSink}
            label="Remove topic from S3 sink connector"
            description="Stops future S3 exports for this tribe topic. Existing S3 data remains."
            disabled={usesSharedTribeResources}
            onChange={setRemoveFromSink}
          />
          <CleanupOption
            checked={deregister}
            label="Deregister API Center registry entry"
            description="Removes the tribe from API Center registry state."
            onChange={setDeregister}
          />
        </div>

        {!usesSharedTribeResources ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <OperationPreviewPanel
              title="Secret cleanup preview"
              description="Preview the Secret Manager delete operation before cleanup."
              preview={secretPreview}
              live={isLive}
              typedPhrase={typedPhrase}
              reason={operatorReason}
              previewPending={secretPreviewMutation.isPending}
              onPreview={() => secretPreviewMutation.mutate()}
              onTypedPhraseChange={setTypedPhrase}
              onReasonChange={setOperatorReason}
            />
            <OperationPreviewPanel
              title="S3 sink cleanup preview"
              description="Preview removing the tribe topic from the managed S3 Sink connector."
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
        ) : null}

        <div className="grid gap-2">
          <label htmlFor="deprovision-confirm" className="text-sm font-medium">
            Type {serviceId} to confirm selected cleanup.
          </label>
          <Input
            id="deprovision-confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder={serviceId}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="destructive"
            disabled={!canRun}
            onClick={() => mutation.mutate()}
          >
            Run selected cleanup
          </Button>
          <p className="text-sm text-muted-foreground">
            Confluent topic deletion is intentionally not automated.
          </p>
        </div>

        {results.length ? (
          <Alert>
            <AlertTitle>Last cleanup result</AlertTitle>
            <AlertDescription>
              {results
                .map((result) => `${result.label}: ${result.status}`)
                .join(", ")}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ResourceDetail({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <Badge variant="secondary">{status}</Badge>
      </div>
      <div className="mt-2 break-all font-mono text-sm">{value}</div>
    </div>
  );
}

function CleanupOption({
  checked,
  label,
  description,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex gap-3 rounded-lg border bg-background p-3 text-sm ${
        disabled ? "opacity-60" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 accent-foreground"
      />
      <span className="flex flex-col gap-1">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
