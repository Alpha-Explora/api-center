"use client";

import Link from "next/link";
import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  getConfluentPipelineStatus,
  getTopicOnboardingState,
  getTribeSecretStatus,
  listQuotaPolicies,
} from "@/lib/api-center-client";
import { getServiceEventTopics } from "@/lib/event-topics";
import { isDataPipelineEnabled } from "@/lib/feature-flags";
import {
  deriveTribeS3OnboardingState,
  type TopicOnboardingStateRecord,
  type TribeS3OnboardingState,
} from "@/lib/service-onboarding";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type OnboardingStep = {
  label: string;
  description: string;
  status:
    | "complete"
    | "pending"
    | "checking"
    | "blocked"
    | "unknown"
    | "skipped";
  actionHref?: string;
  actionLabel?: string;
};

export function TribeOnboardingFlow({
  serviceId,
  ownerTribeId,
  consumes,
  healthCheck,
  ownerTeam,
  contact,
  requiredScopes = [],
}: {
  serviceId: string;
  ownerTribeId?: string;
  consumes: string[];
  healthCheck?: string;
  ownerTeam?: string;
  contact?: string;
  requiredScopes?: string[];
}) {
  const dataPipelineEnabled = isDataPipelineEnabled();
  const tribePrincipalId = ownerTribeId ?? serviceId;
  const topicName = getServiceEventTopics({
    serviceId,
    ownerTribeId,
    serviceType: "tribe",
  }).primary;
  const secretStatusQuery = useQuery({
    queryKey: queryKeys.tribeSecretStatus(tribePrincipalId),
    queryFn: () => getTribeSecretStatus(tribePrincipalId),
    retry: 1,
  });
  const confluentStatusQuery = useQuery({
    queryKey: queryKeys.confluentPipelineStatus(serviceId, topicName),
    queryFn: () => getConfluentPipelineStatus(serviceId, topicName),
    enabled: dataPipelineEnabled,
    retry: 1,
  });
  const topicStateQuery = useQuery({
    queryKey: queryKeys.topicOnboardingState(topicName),
    queryFn: () =>
      getTopicOnboardingState({
        serviceId,
        ownerTribeId,
        topicName,
      }),
    enabled: dataPipelineEnabled,
    retry: false,
  });
  const quotaPoliciesQuery = useQuery({
    queryKey: queryKeys.quotaPolicies(tribePrincipalId),
    queryFn: () => listQuotaPolicies(tribePrincipalId),
    retry: 1,
  });
  const activeQuotaPolicy = quotaPoliciesQuery.data?.find(
    (policy) => policy.status === "active",
  );
  const secretExists = Boolean(secretStatusQuery.data?.exists);
  const secretStatus: OnboardingStep["status"] = secretStatusQuery.isError
    ? "blocked"
    : secretExists
      ? "complete"
      : "pending";
  const hasKafkaWriteScope =
    requiredScopes.includes("external:kafka:write") ||
    requiredScopes.includes("kafka:write");
  const topicExists =
    dataPipelineEnabled && Boolean(confluentStatusQuery.data?.topicExists);
  const s3SinkIncludesTopic = Boolean(
    dataPipelineEnabled && confluentStatusQuery.data?.s3SinkIncludesTopic,
  );
  const s3FailureReason =
    confluentStatusQuery.isError ||
    confluentStatusQuery.data?.topicCheckOk === false ||
    confluentStatusQuery.data?.s3SinkCheckOk === false
      ? (confluentStatusQuery.data?.topicCheckError ??
        confluentStatusQuery.data?.s3SinkCheckError ??
        "Pipeline status check failed.")
      : undefined;
  const classificationKnown =
    hasKafkaWriteScope || topicExists || s3SinkIncludesTopic;
  const derivedS3OnboardingState = deriveTribeS3OnboardingState({
    classificationApproved: classificationKnown,
    hasScope: hasKafkaWriteScope || topicExists || s3SinkIncludesTopic,
    topicExists,
    s3SinkIncludesTopic,
    failureReason: s3FailureReason,
  });
  const topicStateRecord = topicStateQuery.data;
  const s3OnboardingState = topicStateRecord?.transition_history.length
    ? topicStateRecord.current_state
    : derivedS3OnboardingState;

  const steps: OnboardingStep[] = [
    {
      label: "Manifest registered",
      description:
        tribePrincipalId === serviceId
          ? "This service exists in the API Center registry."
          : `This service exists in the API Center registry under tribe ${tribePrincipalId}.`,
      status: "complete",
      actionHref: `/tribes/${serviceId}/edit`,
      actionLabel: "Edit manifest",
    },
    {
      label: "Shared-service access declared",
      description: consumes.length
        ? `${consumes.length} shared-service dependency/dependencies declared.`
        : "Declare consumed shared services before issuing SDK credentials.",
      status: consumes.length ? "complete" : "pending",
      actionHref: `/tribes/${serviceId}/edit`,
      actionLabel: "Edit access",
    },
    {
      label: "Owner and contact set",
      description: "Ownership is needed before tribes depend on this service.",
      status: ownerTeam && contact ? "complete" : "pending",
      actionHref: `/tribes/${serviceId}/edit`,
      actionLabel: "Update owner",
    },
    {
      label: "Health path set",
      description: "Health checks and readiness reporting use this path.",
      status: healthCheck ? "complete" : "pending",
      actionHref: `/tribes/${serviceId}/edit`,
      actionLabel: "Update health",
    },
    {
      label: activeQuotaPolicy ? "Active quota policy" : "Quota policy",
      description: getQuotaPolicyDescription(
        activeQuotaPolicy,
        quotaPoliciesQuery.isFetching,
        quotaPoliciesQuery.isError,
      ),
      status: quotaPoliciesQuery.isFetching
        ? "checking"
        : activeQuotaPolicy
          ? "complete"
          : quotaPoliciesQuery.isError
            ? "unknown"
            : "pending",
      actionHref: serviceDetailHref(serviceId, "quotas"),
      actionLabel: "Open quotas",
    },
    {
      label: "Tribe secret provisioned",
      description: getSecretDescription(
        secretStatus,
        secretStatusQuery.isPending,
      ),
      status: secretStatusQuery.isFetching ? "checking" : secretStatus,
    },
    {
      label: "Confluent topic created",
      description: dataPipelineEnabled
        ? getConfluentTopicDescription(
            topicName,
            confluentStatusQuery.data?.topicCheckOk,
            confluentStatusQuery.isFetching,
            confluentStatusQuery.isError,
          )
        : "Data pipeline disabled for this environment; topic setup is skipped.",
      status: dataPipelineEnabled
        ? getConfluentStatus(
            confluentStatusQuery.data?.topicExists,
            confluentStatusQuery.data?.topicCheckOk,
            confluentStatusQuery.isFetching,
            confluentStatusQuery.isError,
          )
        : "skipped",
    },
    {
      label: "Topic added to S3 sink",
      description: dataPipelineEnabled
        ? getS3SinkDescription(
            confluentStatusQuery.data?.s3SinkCheckOk,
            confluentStatusQuery.data?.s3SinkCheckError,
            confluentStatusQuery.isFetching,
            confluentStatusQuery.isError,
          )
        : "Data pipeline disabled for this environment; S3 Sink setup is skipped.",
      status: dataPipelineEnabled
        ? getConfluentStatus(
            confluentStatusQuery.data?.s3SinkIncludesTopic,
            confluentStatusQuery.data?.s3SinkCheckOk,
            confluentStatusQuery.isFetching,
            confluentStatusQuery.isError,
          )
        : "skipped",
    },
    {
      label: "S3 onboarding state",
      description: dataPipelineEnabled
        ? getS3OnboardingDescription(
            s3OnboardingState,
            topicName,
            serviceId,
            tribePrincipalId,
            confluentStatusQuery.isFetching,
          )
        : "Data pipeline disabled for this environment; raw export onboarding is skipped.",
      status: dataPipelineEnabled
        ? confluentStatusQuery.isFetching
          ? "checking"
          : getS3OnboardingStepStatus(s3OnboardingState)
        : "skipped",
    },
    {
      label: "Token issued",
      description: `Request an API Center token with the ${tribePrincipalId} tribe secret.`,
      status: "pending",
      actionHref: serviceDetailHref(serviceId, "actions"),
      actionLabel: "Open token test",
    },
    {
      label: "Safe smoke checks pass",
      description: "Run safe shared-service checks through API Center.",
      status: "pending",
      actionHref: serviceDetailHref(serviceId, "actions"),
      actionLabel: "Open smoke tests",
    },
    {
      label: "Usage and audit checked",
      description:
        "Confirm calls appear in shared usage and audit after testing.",
      status: "pending",
      actionHref: serviceDetailHref(serviceId, "dependencies"),
      actionLabel: "Open usage",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Onboarding flow</CardTitle>
        <CardDescription>
          Work through these steps after registering a tribe service.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className="grid gap-3 rounded-lg border bg-card p-3 text-sm sm:grid-cols-[2rem_1fr_auto]"
          >
            <div className={statusIconClassName(step.status)}>
              {step.status === "complete" ? (
                <CheckCircleIcon data-icon="inline-start" />
              ) : step.status === "checking" ? (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : step.status === "unknown" ? (
                <CircleHelpIcon data-icon="inline-start" />
              ) : step.status === "blocked" ? (
                <CircleHelpIcon data-icon="inline-start" />
              ) : (
                <CircleDashedIcon data-icon="inline-start" />
              )}
              <span className="sr-only">Step {index + 1}</span>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{step.label}</span>
                <span className={statusLabelClassName(step.status)}>
                  {getStatusLabel(step.status)}
                </span>
              </div>
              <div className="mt-1 text-muted-foreground">
                {step.description}
              </div>
            </div>
            {step.actionHref && step.actionLabel ? (
              <Button
                nativeButton={false}
                variant="outline"
                size="sm"
                render={<Link href={step.actionHref} />}
              >
                {step.actionLabel}
              </Button>
            ) : null}
          </div>
        ))}
        {consumes.length ? (
          <div className="rounded-lg border bg-muted/25 p-3 text-sm text-muted-foreground">
            Declared shared-service access:{" "}
            <span className="font-mono text-foreground">
              {consumes.join(", ")}
            </span>
          </div>
        ) : null}
        {topicStateRecord ? (
          <TopicStateSummary record={topicStateRecord} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function TopicStateSummary({ record }: { record: TopicOnboardingStateRecord }) {
  const rows = [
    ["Owner tribe ID", record.owner_tribe_id],
    ["Source services", record.source_service_ids.join(", ")],
    ["Classification tier", record.classification_tier],
    ["Retention tier", record.retention_tier],
    ["Data owner", record.data_owner],
    ["Approved readers", record.approved_reader_groups.join(", ")],
    ["Publish quota", record.publish_quota],
    ["Max event size", record.event_size_limit],
    ["Latest S3 object", record.latest_s3_object_key],
    ["Latest S3 object at", record.latest_s3_object_at],
    ["Latest Bronze count", record.latest_bronze_count],
    ["Latest Bronze observed at", record.latest_bronze_observed_at],
    ["Quality error count", record.quality_error_count],
    ["Common Silver observed", record.latest_common_silver_observed_at],
    ["Gold observed", record.latest_gold_observed_at],
    ["Last access review", record.last_access_review_at],
    ["Exception status", record.exception_status],
    ["Next review", record.next_review_date],
  ];

  return (
    <div className="rounded-lg border bg-muted/25 p-3 text-sm">
      <div className="font-medium">Topic state record</div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 truncate font-mono text-xs text-foreground">
              {formatTopicStateValue(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function formatTopicStateValue(value: string | number | undefined) {
  if (typeof value === "number") return String(value);
  return value?.trim() ? value : "Not recorded";
}

function getS3OnboardingDescription(
  state: TribeS3OnboardingState,
  topicName: string,
  serviceId: string,
  tribePrincipalId: string,
  isPending: boolean,
) {
  if (isPending) return `Checking S3 onboarding state for ${topicName}.`;

  const attribution =
    serviceId === tribePrincipalId
      ? `Owner tribe topic: ${topicName}.`
      : `Owner tribe topic: ${topicName}; source service ${serviceId}.`;

  return `${state}. ${attribution}`;
}

function getS3OnboardingStepStatus(
  state: TribeS3OnboardingState,
): OnboardingStep["status"] {
  if (state === "Rejected" || state === "Blocked by exception") {
    return "blocked";
  }
  if (state === "Needs remediation") return "blocked";
  if (
    state === "Raw observed" ||
    state === "Bronze cataloged" ||
    state === "Curated active"
  ) {
    return "complete";
  }
  return "pending";
}

function getSecretDescription(
  status: OnboardingStep["status"],
  isPending: boolean,
) {
  if (isPending) return "Checking the per-tribe Secret Manager hash.";
  if (status === "complete") return "The per-tribe Secret Manager hash exists.";
  if (status === "blocked" || status === "unknown") {
    return "Secret status could not be checked from the management environment.";
  }
  return "Generate and provision the tribe secret in the card below.";
}

function getQuotaPolicyDescription(
  policy:
    | {
        mode: "observe" | "enforce";
        scope: "all" | "shared" | "tribe" | "kafka_publish";
        targetServiceId?: string | null;
        maxRequests: number;
        windowSeconds: number;
      }
    | undefined,
  isPending: boolean,
  isError: boolean,
) {
  if (isPending) return "Checking active tribe quota policies.";
  if (isError) return "Quota policy status could not be checked.";
  if (!policy) return "Default platform throttle applies";

  const target = policy.targetServiceId ? ` for ${policy.targetServiceId}` : "";
  return `${policy.mode} ${policy.scope.replace("_", " ")} quota: ${policy.maxRequests} requests per ${policy.windowSeconds}s${target}.`;
}

function getConfluentTopicDescription(
  topicName: string,
  checkOk: boolean | undefined,
  isPending: boolean,
  isError: boolean,
) {
  if (isPending) return `Checking ${topicName} in Confluent.`;
  if (isError || checkOk === false) {
    return "Confluent topic status could not be checked from this local app.";
  }
  return `Create or verify ${topicName} in the Confluent data pipeline card below.`;
}

function getS3SinkDescription(
  checkOk: boolean | undefined,
  error: string | undefined,
  isPending: boolean,
  isError: boolean,
) {
  if (isPending) return "Checking the managed S3 Sink connector topic list.";
  if (isError || checkOk === false) {
    return formatS3SinkError(error);
  }
  return "Add the tribe topic to the managed S3 Sink connector when exports should start.";
}

function getConfluentStatus(
  value: boolean | undefined,
  checkOk: boolean | undefined,
  isFetching: boolean,
  isError: boolean,
): OnboardingStep["status"] {
  if (isFetching) return "checking";
  if (isError || checkOk === false) return "blocked";
  return value ? "complete" : "pending";
}

function getStatusLabel(status: OnboardingStep["status"]) {
  if (status === "complete") return "Done";
  if (status === "checking") return "Checking";
  if (status === "blocked") return "Needs access";
  if (status === "unknown") return "Not checked";
  if (status === "skipped") return "Skipped";
  return "Pending";
}

function statusLabelClassName(status: OnboardingStep["status"]) {
  return cn(
    "rounded-md border px-1.5 py-0.5 text-xs font-medium",
    status === "complete" &&
      "border-[var(--brand-green)]/35 bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]",
    status === "checking" && "border-border bg-muted/35 text-muted-foreground",
    status === "blocked" &&
      "border-destructive/30 bg-destructive/5 text-destructive",
    status === "pending" && "border-border bg-muted/35 text-muted-foreground",
    status === "unknown" && "border-border bg-muted/35 text-muted-foreground",
    status === "skipped" && "border-border bg-muted/35 text-muted-foreground",
  );
}

function statusIconClassName(status: OnboardingStep["status"]) {
  return cn(
    "flex size-7 items-center justify-center rounded-full border font-mono text-xs",
    status === "complete" &&
      "border-[var(--brand-green)] bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]",
    status === "checking" && "border-border bg-muted/40 text-muted-foreground",
    status === "blocked" &&
      "border-destructive/40 bg-destructive/5 text-destructive",
    status === "unknown" && "border-border bg-muted/40 text-muted-foreground",
    status === "pending" && "border-border bg-card text-muted-foreground",
    status === "skipped" && "border-border bg-card text-muted-foreground",
  );
}

function formatS3SinkError(error: string | undefined) {
  if (!error) return "S3 sink status could not be checked from this local app.";
  if (error.includes("401") || error.toLowerCase().includes("unauthorized")) {
    return "Unauthorized. Check CONFLUENT_CLOUD_API_KEY and CONFLUENT_CLOUD_API_SECRET, then restart the local app.";
  }
  if (error.includes("403") || error.toLowerCase().includes("forbidden")) {
    return "Forbidden. The Cloud API key is valid but needs permission on the S3 sink connector.";
  }
  return error;
}

function serviceDetailHref(serviceId: string, section: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=${encodeURIComponent(section)}`;
}
