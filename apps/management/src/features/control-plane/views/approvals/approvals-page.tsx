"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InboxIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorPanel } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDateTime } from "@/lib/format";
import { APPROVAL_KIND_LABEL, approvalHref, type ApprovalItem } from "../../model/approvals";
import { useApprovals } from "../../view-models/approvals";
import { useOrganization } from "../../view-models/use-organization";
import { RelativeTime } from "@/components/patterns/relative-time";

export function ApprovalsPage() {
  const { organizationId, platformAdmin, setOrganizationId, loading } = useOrganization();
  const approvals = useApprovals();
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
            ? "Live activations and API access requests waiting for a decision, across every organization."
            : "Live activations and API access requests in this organization that you can decide."
        }
      />
      {!loading && !organizationId && !platformAdmin ? (
        <EmptyState title="No organization selected" description="Choose an organization from the switcher in the sidebar." />
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
            <EmptyState icon={<InboxIcon />} title="Nothing waiting" description="Requests to activate live or to call another project's API appear here until someone decides them." />
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
            {item.kind === "api_access" ? ` · ${item.environmentKind}` : ""}
          </span>
        </div>
        <p className="mt-1 text-[13px] font-medium break-words">{item.summary}</p>
        {item.kind === "live_activation" && item.reason ? <p className="mt-0.5 text-[13px] break-words text-muted-foreground">“{item.reason}”</p> : null}
        <p className="mt-0.5 text-xs text-muted-foreground">
          Requested by {item.requestedByYou ? "you" : item.requestedBy} <time dateTime={item.requestedAt} title={formatDateTime(item.requestedAt)}><RelativeTime value={item.requestedAt} /></time>
          {item.requestedByYou ? " · someone else must decide it" : ""}
        </p>
      </div>
      <Link
        href={approvalHref(item)}
        onClick={(event) => {
          event.preventDefault();
          onOpen();
        }}
        className="inline-flex h-8 shrink-0 items-center justify-center self-start rounded-md border bg-background px-3 text-[13px] font-medium shadow-xs transition-colors hover:bg-muted sm:self-center"
      >
        {item.requestedByYou ? "View" : "Review"}
      </Link>
    </div>
  );
}
