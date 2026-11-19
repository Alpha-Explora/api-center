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
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { controlPlane } from "../../data/control-plane-repository";
import { PROJECT_ADMIN_REASON } from "../../model/access";
import type { ActivationRequest } from "../../model/control-plane";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";
import { useOrganization } from "../../view-models/use-organization";

/** Live setup: provision, pass readiness, get a second person's approval, activate. */
export function GoLivePanel() {
  const { organizationId, project, environment, canManage } = useProjectEnvironment();
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: cpKeys.project(organizationId, project.id) });
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
  const readiness = useQuery({ queryKey: cpKeys.liveReadiness(organizationId, project.id), queryFn: () => controlPlane.liveReadiness(organizationId, project.id), retry: false });
  const requests = useQuery({
    queryKey: cpKeys.activationRequests(organizationId, project.id),
    queryFn: () => controlPlane.activationRequests(organizationId, project.id),
    retry: false,
  });
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState<ActivationRequest | null>(null);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: cpKeys.project(organizationId, project.id) });
    void client.invalidateQueries({ queryKey: cpKeys.liveReadiness(organizationId, project.id) });
    void client.invalidateQueries({ queryKey: cpKeys.activationRequests(organizationId, project.id) });
  };
  const onError = (error: Error) => toast.error(error.message);
  const request = useMutation({
    mutationFn: () => controlPlane.requestActivation(organizationId, project.id, reason.trim()),
    onSuccess: () => {
      toast.success("Activation requested. Another admin must approve it.");
      setReason("");
      refresh();
    },
    onError,
  });
  const decide = useMutation({
    mutationFn: (input: { id: string; decision: "approve" | "reject"; reason?: string }) =>
      controlPlane.decideActivation(organizationId, project.id, input.id, input.decision, input.reason),
    onSuccess: (_, input) => {
      toast.success(input.decision === "approve" ? "Activation approved" : "Activation rejected");
      setRejecting(null);
      refresh();
    },
    onError,
  });
  const activate = useMutation({
    mutationFn: (approvalRequestId: string) => controlPlane.activateLive(organizationId, project.id, approvalRequestId),
    onSuccess: () => {
      toast.success("Live is active");
      refresh();
    },
    onError,
  });

  const data = readiness.data;
  const open = (requests.data ?? []).filter((entry) => entry.status === "pending" || entry.status === "approved");
  const history = (requests.data ?? []).filter((entry) => entry.status !== "pending" && entry.status !== "approved");
  const me = session?.email?.toLowerCase();

  return (
    <Panel title="Going live" description="Live is provisioning. It serves no requests until it is activated.">
      {readiness.error ? <ErrorPanel title="Readiness is unavailable" error={readiness.error} /> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Readiness</h3>
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
          {open.map((entry) => {
            const mine = me !== undefined && entry.requestedBy.toLowerCase() === me;
            return (
              <div key={entry.id} className="rounded-md border p-3 text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={entry.status}>{entry.status === "pending" ? "Waiting for approval" : "Approved"}</StatusBadge>
                  <span className="text-xs text-muted-foreground">{formatRelative(entry.createdAt)}</span>
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
                  ) : (
                    <GuardedButton
                      size="sm"
                      allowed={canManage && Boolean(data?.ready)}
                      reason={canManage ? "Every readiness check must pass first." : PROJECT_ADMIN_REASON}
                      disabled={activate.isPending}
                      onClick={() => activate.mutate(entry.id)}
                    >
                      <RocketIcon data-icon="inline-start" /> Activate live
                    </GuardedButton>
                  )}
                </div>
              </div>
            );
          })}

          {open.length === 0 ? (
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
                  reason={canManage ? "Every readiness check must pass first." : PROJECT_ADMIN_REASON}
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
