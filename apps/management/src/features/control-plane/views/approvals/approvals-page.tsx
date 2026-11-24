"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InboxIcon } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorPanel } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { APPROVAL_KIND_LABEL, DECISION_LABEL, approvalHref, type ApprovalItem } from "../../model/approvals";
import { useApprovals } from "../../view-models/approvals";
import { useOrganization } from "../../view-models/use-organization";
import { RelativeTime } from "@/components/patterns/relative-time";
import { featureAccess } from "../../data/features";
import { cpKeys } from "../../view-models/query-keys";

export function ApprovalsPage() {
  const { organizationId, platformAdmin, setOrganizationId, loading } = useOrganization();
  const [view, setView] = useState<"pending" | "decided">("pending");
  const pending = useApprovals("pending");
  const decided = useApprovals("decided", { enabled: view === "decided" });
  const approvals = view === "pending" ? pending : decided;
  const router = useRouter();
  const items = approvals.data ?? [];
  // Decisions are made inside the organization, so following a link first switches to it.
  const openItem = (item: ApprovalItem) => {
    if (item.organizationId !== organizationId) setOrganizationId(item.organizationId);
    router.push(approvalHref(item));
  };

  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          platformAdmin
            ? "Review feature access, live activation and API access requests across organizations."
            : "Track requests for this organization and decide those your role allows."
        }
      />
      {!loading && !organizationId && !platformAdmin ? (
        <EmptyState title="No organization selected" description="Choose an organization from the switcher in the sidebar." />
      ) : null}
      {organizationId || platformAdmin ? (
        <div role="tablist" aria-label="Approvals" className="inline-flex w-fit rounded-md border bg-muted/40 p-0.5 text-[13px]">
          {(
            [
              ["pending", `Waiting${pending.data ? ` (${pending.data.length})` : ""}`],
              ["decided", "Recently decided"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => setView(value)}
              className={
                view === value
                  ? "rounded-[5px] bg-background px-3 py-1 font-medium shadow-xs"
                  : "rounded-[5px] px-3 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {approvals.error ? <ErrorPanel title="Approvals could not be loaded" error={approvals.error} /> : null}
      {!approvals.error && (organizationId || platformAdmin) ? (
        <Panel flush>
          {approvals.isLoading ? (
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : items.length === 0 ? (
            view === "pending" ? (
              <EmptyState icon={<InboxIcon />} title="Nothing waiting" description="New feature access, live activation and API access requests appear here." />
            ) : (
              <EmptyState icon={<InboxIcon />} title="Nothing decided in the last 30 days" description="Approved and rejected requests stay here for 30 days." />
            )
          ) : (
            <ul className="divide-y">
              {items.map((item) => (
                <li key={`${item.kind}:${item.id}`}>
                  <ApprovalRow item={item} showOrganization={platformAdmin} onOpen={() => openItem(item)} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </>
  );
}

function ApprovalRow({ item, showOrganization, onOpen }: { item: ApprovalItem; showOrganization: boolean; onOpen: () => void }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={item.kind === "live_activation" ? "warning" : "info"}>{APPROVAL_KIND_LABEL[item.kind]}</StatusBadge>
          <span className="text-xs text-muted-foreground">
            {showOrganization ? `${item.organizationName} · ` : ""}
            {item.projectName}
            {item.kind !== "live_activation" ? ` · ${item.environmentKind}` : ""}
          </span>
        </div>
        <p className="mt-1 text-[13px] font-medium break-words">{item.summary}</p>
        {item.kind !== "api_access" && item.reason ? <p className="mt-0.5 text-[13px] break-words text-muted-foreground">“{item.reason}”</p> : null}
        <p className="mt-0.5 text-xs text-muted-foreground">
          Requested by {item.requestedByYou ? "you" : item.requestedBy} <RelativeTime value={item.requestedAt} />
          {item.requestedByYou && !item.decision ? " · someone else must decide it" : ""}
        </p>
        {item.kind === "feature" && !item.decision && item.ageHours >= 24 ? <p className="text-xs text-muted-foreground">
          Waiting {Math.floor(item.ageHours / 24)} {item.ageHours < 48 ? "day" : "days"}
        </p> : null}
        {item.decision ? (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <StatusBadge status={item.decision.status === "applied" ? "approved" : item.decision.status}>{DECISION_LABEL[item.decision.status]}</StatusBadge>
            {item.decision.by ? <span>by {item.decision.by}</span> : null}
            <RelativeTime value={item.decision.at} />
            {item.decision.reason ? <span className="text-foreground">· &ldquo;{item.decision.reason}&rdquo;</span> : null}
          </p>
        ) : null}
      </div>
      {item.kind === "feature" && !item.decision && !item.requestedByYou
        ? showOrganization ? <FeatureDecision item={item} /> : <span className="text-xs text-muted-foreground">Waiting for APICenter</span>
        : null}
      <Link
        href={approvalHref(item)}
        onClick={(event) => {
          event.preventDefault();
          onOpen();
        }}
        className="inline-flex h-8 shrink-0 items-center justify-center self-start rounded-md border bg-background px-3 text-[13px] font-medium shadow-xs transition-colors hover:bg-muted sm:self-center"
      >
        {item.decision || item.requestedByYou || item.kind === "feature" ? "View" : "Review"}
      </Link>
    </div>
  );
}

function FeatureDecision({ item }: { item: Extract<ApprovalItem, { kind: "feature" }> }) {
  const client = useQueryClient();
  const [choice, setChoice] = useState<"approve" | "reject" | null>(null);
  const decision = useMutation({
    mutationFn: (note: string) => featureAccess.decide(item.id, choice === "approve" ? { approve: true } : { approve: false, note }),
    onSuccess: () => {
      toast.success(choice === "approve" ? "Request approved" : "Request rejected");
      setChoice(null);
      void client.invalidateQueries({ queryKey: cpKeys.approvalsRoot });
      void client.invalidateQueries({ queryKey: ["features", item.organizationId, item.projectId, item.environmentKind] });
    },
  });
  return <div className="flex items-center gap-2">
    <Button type="button" size="sm" variant="outline" onClick={() => { decision.reset(); setChoice("reject"); }}>Reject</Button>
    <Button type="button" size="sm" onClick={() => { decision.reset(); setChoice("approve"); }}>Approve</Button>
    <ConfirmDialog open={choice !== null} onOpenChange={(open) => { if (!open) setChoice(null); }}
      title={choice === "approve" ? "Approve feature request" : "Reject feature request"}
      description={item.summary} reasonLabel={choice === "reject" ? "Reason for rejecting" : undefined}
      confirmLabel={choice === "approve" ? "Approve request" : "Reject request"} destructive={choice === "reject"}
      busy={decision.isPending} onConfirm={(reason) => decision.mutate(reason)}>
      {decision.error ? <ErrorPanel error={decision.error} /> : null}
    </ConfirmDialog>
  </div>;
}
