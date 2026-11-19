"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { HistoryIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/patterns/empty-state";
import { NativeSelect } from "@/components/patterns/form";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { Panel } from "@/components/patterns/panel";
import { controlPlane } from "../../data/control-plane-repository";
import { AUDIT_REASON, type Access } from "../../model/access";
import { AUDIT_ACTION_TYPES, AUDIT_RANGES, type AuditEntry, type AuditFilters, type AuditRange } from "../../model/observability";
import { useAnchoredNow, useAuditLog } from "../../view-models/observability";
import { PageSkeleton } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";
import { useAccess, useOrganization } from "../../view-models/use-organization";
import { AuditSheet, AuditTable } from "./audit-parts";

const DESCRIPTION = "Who changed what in the organization: projects, keys, grants, roles, quotas, webhooks and going live.";

export function AuditLogPage() {
  const { organizationId } = useOrganization();
  const { access, loading } = useAccess(organizationId);

  if (!organizationId) return <EmptyState title="No organization selected" description="Choose an organization from the switcher in the sidebar." />;
  if (loading) return <PageSkeleton />;
  if (!access.canReadAuditLog) {
    return (
      <>
        <PageHeader title="Audit log" description={DESCRIPTION} />
        <Notice title="The audit log is for admins">
          {AUDIT_REASON} Your organization role is {access.organizationRole ?? "not set"}.
        </Notice>
      </>
    );
  }
  return <AuditLog organizationId={organizationId} access={access} />;
}

function AuditLog({ organizationId, access }: { organizationId: string; access: Access }) {
  const organizationWide = access.canReadOrganizationAudit;
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<AuditFilters>(() => ({
    range: "7d",
    projectId: searchParams.get("projectId") ?? undefined,
  }));
  const [actorInput, setActorInput] = useState("");
  const { now, refresh } = useAnchoredNow();
  const log = useAuditLog(organizationId, filters, now);
  const projects = useQuery({
    queryKey: cpKeys.projects(organizationId),
    queryFn: () => controlPlane.listProjects(organizationId),
    retry: false,
  });
  const names = new Map((projects.data ?? []).map((project) => [project.id, project.name]));
  const projectOptions = (projects.data ?? []).filter((project) => organizationWide || access.canManageProject(project.id));
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const entries = log.data?.pages.flatMap((page) => page.items) ?? [];
  const set = (patch: Partial<AuditFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const filtered = Boolean(filters.projectId || filters.actor || filters.action);

  return (
    <>
      <PageHeader
        title="Audit log"
        description={DESCRIPTION}
        actions={
          <Button size="sm" variant="outline" onClick={refresh} disabled={log.isFetching}>
            <RefreshCwIcon data-icon="inline-start" /> Refresh
          </Button>
        }
      />
      {organizationWide ? null : (
        <Notice>
          You administer {projectOptions.length === 1 ? "one project" : `${projectOptions.length} projects`}, so you see their events. Member and team changes
          are visible to organization owners and admins.
        </Notice>
      )}
      <Panel flush>
        <form
          className="grid gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            set({ actor: actorInput.trim() || undefined });
          }}
        >
          <NativeSelect aria-label="Project" value={filters.projectId ?? ""} onChange={(event) => set({ projectId: event.target.value || undefined })}>
            <option value="">{organizationWide ? "All projects and organization" : "All my projects"}</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Action type" value={filters.action ?? ""} onChange={(event) => set({ action: event.target.value || undefined })}>
            <option value="">Every action</option>
            {AUDIT_ACTION_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </NativeSelect>
          <Input
            aria-label="Actor email"
            type="search"
            placeholder="Actor email, then Enter"
            value={actorInput}
            onChange={(event) => {
              setActorInput(event.target.value);
              if (!event.target.value) set({ actor: undefined });
            }}
            onBlur={() => set({ actor: actorInput.trim() || undefined })}
          />
          <NativeSelect aria-label="Time range" value={filters.range} onChange={(event) => set({ range: event.target.value as AuditRange })}>
            {AUDIT_RANGES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </NativeSelect>
        </form>

        {log.isPending ? (
          <div className="flex flex-col gap-2 p-4" role="status">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : log.error && entries.length === 0 ? (
          <div className="p-4">
            <ErrorPanel title="The audit log could not be loaded" error={log.error} />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon />}
            title="No events match"
            description={
              filtered ? "Try another project, actor or action, or a longer time range." : "Changes made in the console or by operator scripts appear here."
            }
          />
        ) : (
          <>
            <AuditTable entries={entries} onSelect={setSelected} projectName={(id) => names.get(id)} />
            <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-xs text-muted-foreground">
              <span>
                {entries.length.toLocaleString("en")} event
                {entries.length === 1 ? "" : "s"} shown
              </span>
              {log.hasNextPage ? (
                <Button size="sm" variant="outline" onClick={() => void log.fetchNextPage()} disabled={log.isFetchingNextPage}>
                  {log.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              ) : (
                <span>End of the range</span>
              )}
            </div>
            {log.isFetchNextPageError ? (
              <div className="border-t p-4">
                <ErrorPanel title="The next page could not be loaded" error={log.error} />
              </div>
            ) : null}
          </>
        )}
      </Panel>
      <AuditSheet entry={selected} projectName={(id) => names.get(id)} onOpenChange={(open) => !open && setSelected(null)} />
    </>
  );
}
