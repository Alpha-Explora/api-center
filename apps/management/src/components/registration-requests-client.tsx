"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, EyeIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import {
  approveRegistrationRequest,
  listRegistrationRequests,
  rejectRegistrationRequest,
} from "@/lib/api-center-client";
import { getServiceEventTopics } from "@/lib/event-topics";
import { queryKeys } from "@/lib/query-keys";
import type { ServiceRegistrationRequest } from "@/lib/schemas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const pendingStatus = "pending";

export function RegistrationRequestsClient() {
  const queryClient = useQueryClient();
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>(
    {},
  );
  const [reviewedRequests, setReviewedRequests] = useState<Record<string, boolean>>(
    {},
  );
  const [approvalConfirmations, setApprovalConfirmations] = useState<
    Record<string, { typedPhrase: string; reason: string }>
  >({});
  const [selectedRequestId, setSelectedRequestId] = useState<string>();
  const requestsQuery = useQuery({
    queryKey: queryKeys.registrationRequests(pendingStatus),
    queryFn: () => listRegistrationRequests(pendingStatus),
  });

  const approveMutation = useMutation({
    mutationFn: ({
      requestId,
      confirmation,
    }: {
      requestId: string;
      confirmation?: { typedPhrase: string; reason: string };
    }) =>
      confirmation
        ? approveRegistrationRequest(requestId, confirmation)
        : approveRegistrationRequest(requestId),
    onSuccess: () => {
      toast.success("Registration request approved");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.registrationRequests(pendingStatus),
      });
    },
    onError: (error) => {
      toast.error("Approval failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({
      requestId,
      reason,
    }: {
      requestId: string;
      reason: string;
    }) => rejectRegistrationRequest(requestId, reason),
    onSuccess: (_data, variables) => {
      toast.success("Registration request rejected");
      setRejectReasons((current) => {
        const next = { ...current };
        delete next[variables.requestId];
        return next;
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.registrationRequests(pendingStatus),
      });
    },
    onError: (error) => {
      toast.error("Rejection failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    },
  });

  const requests = requestsQuery.data ?? [];
  const sortedRequests = [...requests].sort((left, right) => {
    const rankDelta = requestReviewRank(left) - requestReviewRank(right);
    if (rankDelta !== 0) return rankDelta;
    return (
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    );
  });
  const selectedRequest =
    sortedRequests.find((request) => request.id === selectedRequestId) ??
    sortedRequests[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Pending manifest submissions</div>
          <div className="text-sm text-muted-foreground">
            Approvals call API Center and create or update the registry entry.
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void requestsQuery.refetch()}
          disabled={requestsQuery.isFetching}
        >
          <RefreshCwIcon data-icon="inline-start" />
          Refresh
        </Button>
      </div>

      {requestsQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to load requests</AlertTitle>
          <AlertDescription>
            {requestsQuery.error instanceof Error
              ? requestsQuery.error.message
              : "Registration request lookup failed."}
          </AlertDescription>
        </Alert>
      ) : null}

      {requestsQuery.isLoading ? (
        <Card>
          <CardContent>Loading registration requests...</CardContent>
        </Card>
      ) : null}

      {!requestsQuery.isLoading && !requests.length ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            No pending registration requests.
          </CardContent>
        </Card>
      ) : null}

      {sortedRequests.length ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.8fr)]">
          <div className="overflow-hidden rounded-lg border">
            <div className="hidden grid-cols-[minmax(12rem,1fr)_8rem_9rem_minmax(8rem,0.8fr)_3rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
              <span>Request</span>
              <span>Status</span>
              <span>Validation</span>
              <span>Tribe</span>
              <span className="sr-only">Inspect</span>
            </div>
            <div className="divide-y">
              {sortedRequests.map((request) => (
                <RegistrationRequestRow
                  key={request.id}
                  request={request}
                  selected={selectedRequest?.id === request.id}
                  onSelect={() => setSelectedRequestId(request.id)}
                />
              ))}
            </div>
          </div>
          {selectedRequest ? (
            <RegistrationRequestDetail
              request={selectedRequest}
              rejectReason={rejectReasons[selectedRequest.id] ?? ""}
              reviewed={reviewedRequests[selectedRequest.id] ?? false}
              onRejectReasonChange={(reason) =>
                setRejectReasons((current) => ({
                  ...current,
                  [selectedRequest.id]: reason,
                }))
              }
              onReviewedChange={(reviewed) =>
                setReviewedRequests((current) => ({
                  ...current,
                  [selectedRequest.id]: reviewed,
                }))
              }
              liveConfirmation={approvalConfirmations[selectedRequest.id] ?? { typedPhrase: "", reason: "" }}
              onLiveConfirmationChange={(confirmation) =>
                setApprovalConfirmations((current) => ({
                  ...current,
                  [selectedRequest.id]: confirmation,
                }))
              }
              onApprove={() => {
                const targetsLive = registrationRequestTargetsLive(selectedRequest);
                approveMutation.mutate({
                  requestId: selectedRequest.id,
                  confirmation: targetsLive
                    ? approvalConfirmations[selectedRequest.id]
                    : undefined,
                });
              }}
              onReject={() =>
                rejectMutation.mutate({
                  requestId: selectedRequest.id,
                  reason: rejectReasons[selectedRequest.id] ?? "",
                })
              }
              approving={
                approveMutation.isPending &&
                approveMutation.variables?.requestId === selectedRequest.id
              }
              rejecting={
                rejectMutation.isPending &&
                rejectMutation.variables?.requestId === selectedRequest.id
              }
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RegistrationRequestRow({
  request,
  selected,
  onSelect,
}: {
  request: ServiceRegistrationRequest;
  selected: boolean;
  onSelect: () => void;
}) {
  const issueCount = request.validationReport.issues.length;
  const hasBlockingIssues = request.validationReport.issues.some(
    (issue) => issue.severity === "blocking",
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 md:grid-cols-[minmax(12rem,1fr)_8rem_9rem_minmax(8rem,0.8fr)_3rem] md:items-center">
      <div className="min-w-0">
        <div className="truncate font-medium">{request.serviceId}</div>
        <div className="truncate text-sm text-muted-foreground">
          {request.manifest.name} requested by{" "}
          {request.requestedBy ?? "unknown"}
        </div>
      </div>
      <div className="col-start-1 md:col-auto">
        <Badge variant="outline">{request.status}</Badge>
      </div>
      <div className="col-start-1 md:col-auto">
        <Badge variant={hasBlockingIssues ? "destructive" : "secondary"}>
          {request.validationReport.canApply
            ? "ready"
            : `${issueCount || 1} blocking`}
        </Badge>
      </div>
      <div className="col-start-1 truncate text-sm text-muted-foreground md:col-auto">
        {request.ownerTribeId}
      </div>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect registration request for ${request.serviceId}`}
        title={`Inspect registration request for ${request.serviceId}`}
        onClick={onSelect}
        className="col-start-2 row-start-1 inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground md:col-auto md:row-auto"
      >
        <EyeIcon data-icon="inline-end" />
      </button>
    </div>
  );
}

function RegistrationRequestDetail({
  request,
  rejectReason,
  reviewed,
  onRejectReasonChange,
  onReviewedChange,
  liveConfirmation,
  onLiveConfirmationChange,
  onApprove,
  onReject,
  approving,
  rejecting,
}: {
  request: ServiceRegistrationRequest;
  rejectReason: string;
  reviewed: boolean;
  onRejectReasonChange: (reason: string) => void;
  onReviewedChange: (reviewed: boolean) => void;
  liveConfirmation: { typedPhrase: string; reason: string };
  onLiveConfirmationChange: (confirmation: { typedPhrase: string; reason: string }) => void;
  onApprove: () => void;
  onReject: () => void;
  approving: boolean;
  rejecting: boolean;
}) {
  const topic = getServiceEventTopics({
    serviceId: request.serviceId,
    ownerTribeId: request.ownerTribeId ?? undefined,
    serviceType: request.manifest.serviceType,
  }).primary;
  const hasBlockingIssues = request.validationReport.issues.some(
    (issue) => issue.severity === "blocking",
  );
  const targetsLive = registrationRequestTargetsLive(request);
  const liveConfirmationComplete =
    !targetsLive ||
    (liveConfirmation.typedPhrase === "APPLY LIVE CHANGE" &&
      liveConfirmation.reason.trim().length > 0);

  return (
    <aside
      aria-label="Selected registration request detail"
      className="order-first rounded-lg border bg-muted/10 p-4 xl:order-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Review request</div>
          <div className="mt-1 truncate text-base font-medium">
            {request.serviceId}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {request.manifest.name} requested by{" "}
            {request.requestedBy ?? "unknown"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={hasBlockingIssues ? "destructive" : "secondary"}>
            {request.validationReport.canApply ? "ready" : "blocked"}
          </Badge>
          <Badge variant="outline">{request.status}</Badge>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-4">
        <div className="grid gap-3 border-t pt-4 text-xs sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">Tribe</div>
            <div className="font-medium">{request.ownerTribeId}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Base URL</div>
            <div className="truncate font-medium">{request.manifest.baseUrl}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Consumes</div>
            <div className="truncate font-medium">
              {request.manifest.consumes.length
                ? request.manifest.consumes.join(", ")
                : "none"}
            </div>
          </div>
        </div>

        <div className="grid gap-1 border-t pt-4 font-mono text-xs text-muted-foreground">
          <div>APICENTER_SERVICE_ID={request.serviceId}</div>
          <div>
            project={request.projectId ?? "shared"} tribe={request.ownerTribeId ?? "none"}
          </div>
          <div>topic={topic}</div>
        </div>

        <RegistrationRequestPath request={request} />

        {request.validationReport.issues.length ? (
          <Alert variant={hasBlockingIssues ? "destructive" : "default"}>
            <AlertTitle>Validation issues</AlertTitle>
            <AlertDescription className="grid gap-1">
              {request.validationReport.issues.map((issue) => (
                <span key={`${issue.code}:${issue.message}`}>
                  {issue.severity}: {issue.message}
                </span>
              ))}
            </AlertDescription>
          </Alert>
        ) : null}

        {targetsLive ? (
          <div className="grid gap-3 border-t pt-4">
            <Alert>
              <AlertTitle>Live registry approval</AlertTitle>
              <AlertDescription>
                This approval can update live API Center routing. Enter the live change phrase and reason before approving.
              </AlertDescription>
            </Alert>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                value={liveConfirmation.typedPhrase}
                onChange={(event) =>
                  onLiveConfirmationChange({
                    ...liveConfirmation,
                    typedPhrase: event.target.value,
                  })
                }
                placeholder="APPLY LIVE CHANGE"
                aria-label={`Live approval phrase for ${request.serviceId}`}
              />
              <Input
                value={liveConfirmation.reason}
                onChange={(event) =>
                  onLiveConfirmationChange({
                    ...liveConfirmation,
                    reason: event.target.value,
                  })
                }
                placeholder="Live approval reason"
                aria-label={`Live approval reason for ${request.serviceId}`}
              />
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center">
          <label className="flex min-w-64 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={reviewed}
              onChange={(event) => onReviewedChange(event.target.checked)}
            />
            <span>
              I reviewed this manifest, validation report, owner tribe, and event topic.
            </span>
          </label>
          <Input
            value={rejectReason}
            onChange={(event) => onRejectReasonChange(event.target.value)}
            placeholder="Rejection reason"
            aria-label={`Rejection reason for ${request.serviceId}`}
          />
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              onClick={onApprove}
              disabled={
                approving ||
                rejecting ||
                !request.validationReport.canApply ||
                !reviewed ||
                !liveConfirmationComplete
              }
            >
              <CheckIcon data-icon="inline-start" />
              Approve request
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onReject}
              disabled={approving || rejecting || !rejectReason.trim()}
            >
              <XIcon data-icon="inline-start" />
              Reject
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function RegistrationRequestPath({
  request,
}: {
  request: ServiceRegistrationRequest;
}) {
  const steps = [
    {
      label: "Portal preview",
      detail: "Review the requesting tribe packet.",
      href: `/developer-portal?tribeId=${encodeURIComponent(request.ownerTribeId ?? "")}`,
      action: "Open portal preview",
    },
    {
      label: "Service detail",
      detail: "Inspect manifest, ownership, and lifecycle evidence.",
      href: `/tribes/${encodeURIComponent(request.serviceId)}?section=summary`,
      action: "Open service detail",
    },
    {
      label: "Promotion gates",
      detail: "Check live-readiness after approval.",
      href: serviceDetailHref(request.serviceId, "governance"),
      action: "Open promotion gates",
    },
    {
      label: "Audit trail",
      detail: "Review approval evidence for this service.",
      href: serviceDetailHref(request.serviceId, "evidence"),
      action: "Open audit trail",
    },
  ];

  return (
    <section
      aria-label="Registration request path"
      className="grid gap-2 border-t pt-4"
    >
      <div className="text-sm font-medium">Request path</div>
      <div className="grid gap-2">
        {steps.map((step) => (
          <div
            key={step.label}
            className="grid gap-2 rounded-lg border bg-muted/10 p-3 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium">{step.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {step.detail}
                </div>
              </div>
              <Link
                href={step.href}
                className="text-xs font-medium underline-offset-4 hover:underline"
              >
                {step.action}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}


function registrationRequestTargetsLive(request: ServiceRegistrationRequest) {
  const manifest = request.manifest as ServiceRegistrationRequest["manifest"] & {
    targetEnvironment?: string;
  };
  return (
    manifest.targetEnvironment === "live" ||
    manifest.environments?.some((environment) => environment.environment === "live") === true
  );
}
function requestReviewRank(request: ServiceRegistrationRequest) {
  if (!request.validationReport.canApply) return 0;
  if (request.validationReport.issues.length > 0) return 1;
  return 2;
}

function serviceDetailHref(serviceId: string, section: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=${section}`;
}
