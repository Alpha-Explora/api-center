"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, CircleIcon, RocketIcon } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ErrorPanel } from "@/components/patterns/notices";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { ApiError } from "@/lib/api-center/client-core";

import { cn } from "@/lib/utils";
import { controlPlane } from "../../data/control-plane-repository";
import { PROJECT_ADMIN_REASON } from "../../model/access";
import type { ActivationRequest } from "../../model/control-plane";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";
import { useOrganization } from "../../view-models/use-organization";
import { RelativeTime } from "@/components/patterns/relative-time";

/** Live setup: provision, pass readiness, get a second person's approval, activate. */
export function GoLivePanel() {
  const { organizationId, project, environment, canManage } = useProjectEnvironment();
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: cpKeys.project(organizationId, project.id) });
    void client.invalidateQueries({ queryKey: cpKeys.approvalsRoot });
  };
  const provision = useMutation({
    mutationFn: () => controlPlane.provisionLive(organizationId, project.id),
    onSuccess: () => {
      toast.success("Live environment created");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!environment) {
    return (
      <Panel>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted">
            <RocketIcon className="size-4" />
          </div>
          <div className="flex-1 text-[13px]">
            <p className="text-sm font-semibold">Set up live</p>
            <p className="mt-1 max-w-2xl text-muted-foreground">
              Live is a separate environment. Nothing is copied from test: you add applications, grant access and issue live keys again. Before live
              serves requests it needs a live-capable plan and an activation approved by a second person.
            </p>
            <ol className="mt-3 flex flex-col gap-1.5 text-muted-foreground">
              <Step done={false}>Create the live environment</Step>
              <Step done={false}>Pass the readiness checks</Step>
              <Step done={false}>Request activation, and have another admin approve it</Step>
              <Step done={false}>Activate</Step>
            </ol>
          </div>
          <GuardedButton allowed={canManage} reason={PROJECT_ADMIN_REASON} disabled={provision.isPending} onClick={() => provision.mutate()}>
            Create live environment
          </GuardedButton>
        </div>
      </Panel>
    );
  }

  if (environment.status !== "provisioning") return null;
  return <ProvisioningPanel />;
}

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      {done ? <CheckCircle2Icon className="size-3.5 text-success" /> : <CircleIcon className="size-3.5 text-muted-foreground/60" />}
      <span className={cn(done && "text-foreground")}>{children}</span>
    </li>
  );
}

function ProvisioningPanel() {
  const { organizationId, project, canManage } = useProjectEnvironment();
  const { session } = useOrganization();
  const client = useQueryClient();
  const readiness = useQuery({ queryKey: cpKeys.liveReadiness(organizationId, project.id), queryFn: () => controlPlane.liveReadiness(organizationId, project.id) });
  const requests = useQuery({
    queryKey: cpKeys.activationRequests(organizationId, project.id),
    queryFn: () => controlPlane.activationRequests(organizationId, project.id),
  });
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState<ActivationRequest | null>(null);
  // The approved request to activate, once the person confirms.
  const [activating, setActivating] = useState<ActivationRequest | null>(null);
  const requestsKey = cpKeys.activationRequests(organizationId, project.id);
  // Show the server's answer at once: a refetch can fail while the gateway is busy, and the old
  // "Waiting for approval" with live buttons would invite a second click.
  const storeRequest = (saved: ActivationRequest) => {
    client.setQueryData<ActivationRequest[]>(requestsKey, (current) =>
      current?.some((entry) => entry.id === saved.id)
        ? current.map((entry) => (entry.id === saved.id ? saved : entry))
        : [saved, ...(current ?? [])],
    );
  };
  const refreshActivation = () => {
    void client.invalidateQueries({ queryKey: requestsKey });
    void client.invalidateQueries({ queryKey: cpKeys.approvalsRoot });
  };
  const onError = (error: Error) => toast.error(error.message);
  const request = useMutation({
    mutationFn: () => controlPlane.requestActivation(organizationId, project.id, reason.trim()),
    onSuccess: (saved) => {
      toast.success("Activation requested. Another admin must approve it.");
      setReason("");
      storeRequest(saved);
      refreshActivation();
    },
    onError,
  });
  const decide = useMutation({
    mutationFn: (input: { id: string; decision: "approve" | "reject"; reason?: string }) =>
      controlPlane.decideActivation(organizationId, project.id, input.id, input.decision, input.reason),
    onSuccess: (saved, input) => {
      toast.success(input.decision === "approve" ? "Activation approved" : "Activation rejected");
      setRejecting(null);
      storeRequest(saved);
      refreshActivation();
    },
    onError: (error: Error) => {
      // Someone (possibly this person, in another tab or before a failed refresh) already decided it.
      if (error instanceof ApiError && error.status === 409) {
        toast.info("This request was already decided. Showing its current state.");
        setRejecting(null);
        refreshActivation();
        return;
      }
      onError(error);
    },
  });
  const activate = useMutation({
    mutationFn: (approvalRequestId: string) => controlPlane.activateLive(organizationId, project.id, approvalRequestId),
    onSuccess: () => {
      setActivating(null);
      toast.success("Live is active");
      // The environment's status changes, so everything about the project is refreshed.
      void client.invalidateQueries({ queryKey: cpKeys.project(organizationId, project.id) });
      void client.invalidateQueries({ queryKey: cpKeys.approvalsRoot });
    },
    onError,
  });

  const data = readiness.data;
  // Unknown is not "failed": say so instead of claiming a check did not pass.
  const notReadyReason = !canManage
    ? PROJECT_ADMIN_REASON
    : data
      ? "Every readiness check must pass first."
      : readiness.isPending
        ? "Readiness is still being checked."
        : "Readiness could not be checked. Try again in a moment.";
  const open = (requests.data ?? []).filter((entry) => entry.status === "pending" || entry.status === "approved");
  const history = (requests.data ?? []).filter((entry) => entry.status !== "pending" && entry.status !== "approved");
  const me = session?.email?.toLowerCase();
  const approved = open.find((entry) => entry.status === "approved");
  const pending = open.find((entry) => entry.status === "pending");
  const readyToActivate = Boolean(approved && data?.ready);
  const passed = (data?.checks ?? []).filter((check) => check.passed).length;
  const total = data?.checks.length ?? 0;

  return (
    <Panel
      title={readyToActivate ? "Ready to go live" : "Going live"}
      description={
        readyToActivate && approved
          ? `Every readiness check passes and ${approved.approvedBy ?? "another admin"} approved it. Activating starts serving live traffic.`
          : "Live is provisioning. It serves no requests until it is activated."
      }
      actions={
        readyToActivate && approved ? (
          <GuardedButton allowed={canManage} reason={PROJECT_ADMIN_REASON} disabled={activate.isPending} onClick={() => setActivating(approved)}>
            <RocketIcon data-icon="inline-start" /> Activate live
          </GuardedButton>
        ) : null
      }
    >
      <ol className="mb-5 grid gap-2 text-[13px] sm:grid-cols-3" aria-label="Going live progress">
        <ProgressStep done={Boolean(data?.ready)} label="Readiness" detail={data ? `${passed} of ${total} checks pass` : "Checking…"} />
        <ProgressStep
          done={Boolean(approved)}
          label="Approval"
          detail={approved ? `Approved by ${approved.approvedBy ?? "another admin"}` : pending ? "Waiting for another admin" : "Not requested yet"}
        />
        <ProgressStep done={false} label="Activate" detail={readyToActivate ? "Ready" : "After readiness and approval"} />
      </ol>
      {readiness.error ? <ErrorPanel title="Readiness is unavailable" error={readiness.error} /> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Readiness</h3>
          {readiness.isPending ? <p className="text-[13px] text-muted-foreground">Checking readiness…</p> : null}
          <ul className="flex flex-col gap-2 text-[13px]">
            {(data?.checks ?? []).map((check) => (
              <li key={check.key} className="flex items-start gap-2">
                {check.passed ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleIcon className="mt-0.5 size-4 shrink-0 text-warning" />}
                <span className={cn(!check.passed && "text-foreground")}>{check.detail}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-medium text-muted-foreground">Activation</h3>
          {requests.error ? <ErrorPanel title="Activation requests are unavailable" error={requests.error} /> : null}
          {requests.isPending ? <p className="text-[13px] text-muted-foreground">Loading activation requests…</p> : null}
          {open.map((entry) => {
            const mine = me !== undefined && entry.requestedBy.toLowerCase() === me;
            return (
              <div key={entry.id} className="rounded-md border p-3 text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={entry.status}>{entry.status === "pending" ? "Waiting for approval" : "Approved"}</StatusBadge>
                  <span className="text-xs text-muted-foreground"><RelativeTime value={entry.createdAt} /></span>
                </div>
                <p className="mt-2">&ldquo;{entry.reason}&rdquo;</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Requested by {entry.requestedBy}
                  {entry.approvedBy ? ` · approved by ${entry.approvedBy}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {entry.status === "pending" ? (
                    <>
                      <GuardedButton
                        size="sm"
                        allowed={canManage && !mine}
                        reason={mine ? "You requested this; a different admin must approve it." : PROJECT_ADMIN_REASON}
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: entry.id, decision: "approve" })}
                      >
                        Approve
                      </GuardedButton>
                      <GuardedButton size="sm" variant="outline" allowed={canManage} reason={PROJECT_ADMIN_REASON} disabled={decide.isPending} onClick={() => setRejecting(entry)}>
                        Reject
                      </GuardedButton>
                    </>
                  ) : readyToActivate ? null : (
                    <GuardedButton
                      size="sm"
                      allowed={canManage && Boolean(data?.ready)}
                      reason={notReadyReason}
                      disabled={activate.isPending}
                      onClick={() => setActivating(entry)}
                    >
                      <RocketIcon data-icon="inline-start" /> Activate live
                    </GuardedButton>
                  )}
                </div>
              </div>
            );
          })}

          {/* Only offer a new request once the existing ones are known, so a failed load cannot invite a duplicate. */}
          {requests.isSuccess && open.length === 0 ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                request.mutate();
              }}
            >
              <Textarea
                aria-label="Reason for going live"
                placeholder="Why this project is ready for live traffic"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <div>
                <GuardedButton
                  type="submit"
                  allowed={canManage && Boolean(data?.ready)}
                  reason={notReadyReason}
                  disabled={!reason.trim() || request.isPending}
                >
                  Request activation
                </GuardedButton>
              </div>
            </form>
          ) : null}

          {history.length > 0 ? (
            <details className="text-[13px]">
              <summary className="cursor-pointer text-xs text-muted-foreground">Earlier requests ({history.length})</summary>
              <ul className="mt-2 flex flex-col gap-2">
                {history.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    <StatusBadge status={entry.status} />
                    <span>{entry.requestedBy}</span>
                    {entry.rejectionReason ? <span>· {entry.rejectionReason}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={activating !== null}
        onOpenChange={(next) => !next && setActivating(null)}
        title={`Activate live for ${project.name}`}
        description="Live applications' keys and workload identities start working at once, against real providers. You can suspend live later from project settings."
        confirmLabel="Activate live"
        busy={activate.isPending}
        onConfirm={() => activating && activate.mutate(activating.id)}
      />
      <ConfirmDialog
        open={rejecting !== null}
        onOpenChange={(next) => !next && setRejecting(null)}
        title="Reject activation"
        description={rejecting ? `Requested by ${rejecting.requestedBy}. They will need to request again.` : undefined}
        confirmLabel="Reject"
        destructive
        reasonLabel="Reason"
        busy={decide.isPending}
        onConfirm={(rejection) => rejecting && decide.mutate({ id: rejecting.id, decision: "reject", reason: rejection })}
      />
    </Panel>
  );
}

function ProgressStep({ done, label, detail }: { done: boolean; label: string; detail: string }) {
  return (
    <li className={cn("flex items-start gap-2 rounded-md border px-3 py-2", done && "border-success/30 bg-success-soft")}>
      {done ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />}
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </li>
  );
}
