"use client";
import { useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorPanel } from "@/components/patterns/notices";
import { Panel } from "@/components/patterns/panel";
import type { AuditEntry } from "../../model/observability";
import { useAnchoredNow, useAuditLog } from "../../view-models/observability";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { AuditSheet, AuditTable } from "../audit/audit-parts";

/** The project's last ten audit events, both environments. Project admins only. */
export function ActivityPanel() {
  const { organizationId, project, canManage } = useProjectEnvironment();
  const { now } = useAnchoredNow();
  const log = useAuditLog(organizationId, { projectId: project.id, range: "all" }, now, { limit: 10, enabled: canManage });
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const entries = log.data?.pages[0]?.items ?? [];

  return (
    <Panel
      title="Activity"
      description="Recent changes to this project, in test and live."
      flush
      actions={
        canManage ? (
          <Link href={`/audit?projectId=${encodeURIComponent(project.id)}`} className="text-xs text-muted-foreground hover:text-foreground">
            View all
          </Link>
        ) : null
      }
    >
      {!canManage ? (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">Project admins can see who changed what in this project.</p>
      ) : log.isPending ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : log.error ? (
        <div className="p-4">
          <ErrorPanel title="Activity is unavailable" error={log.error} />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState title="No activity yet" description="Changes to applications, keys, grants, roles and quotas appear here." />
      ) : (
        <AuditTable entries={entries} onSelect={setSelected} showProject={false} />
      )}
      <AuditSheet entry={selected} projectName={() => project.name} onOpenChange={(open) => !open && setSelected(null)} />
    </Panel>
  );
}
