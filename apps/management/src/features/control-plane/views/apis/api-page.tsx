"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { IdText } from "@/components/patterns/copy-button";
import { EmptyState } from "@/components/patterns/empty-state";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { DescriptionList, Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { projectHref } from "@/lib/app-navigation";
import { formatDateTime, formatRelative } from "@/lib/format";
import { publishedApis } from "../../data/published-apis";
import { environmentWriteReason } from "../../model/access";
import type { PublishedApi } from "../../model/published-apis";
import { PageSkeleton, RequireEnvironment, useProjectEnvironment } from "../../view-models/project-environment";
import { apiKeys, useEnvironmentApis } from "../../view-models/published-apis";
import { AccessRequestsPanel } from "./access-requests-panel";
import { EditApiSheet } from "./api-sheet";


export function ApiPage({ apiId }: { apiId: string }) {
  return (
    <RequireEnvironment>
      <ApiDetail apiId={apiId} />
    </RequireEnvironment>
  );
}

function ApiDetail({ apiId }: { apiId: string }) {
  const { project, kind } = useProjectEnvironment();
  const apis = useEnvironmentApis();

  if (apis.error) return <ErrorPanel title="The API could not be loaded" error={apis.error} />;
  if (!apis.data) return <PageSkeleton />;
  const api = apis.data.find((entry) => entry.id === apiId);
  if (!api) {
    return (
      <EmptyState
        title="API not found"
        description={`No ${kind} API ${apiId} in this project. APIs in test and live are published separately.`}
        action={
          <Link href={projectHref(project.id, kind, "/apis")} className="text-[13px] font-medium hover:underline">
            Back to APIs
          </Link>
        }
      />
    );
  }
  return <ApiView api={api} />;
}

function ApiView({ api }: { api: PublishedApi }) {
  const { organizationId, project, kind, canWrite } = useProjectEnvironment();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const active = api.status === "active";
  const setStatus = useMutation({
    mutationFn: (status: "active" | "disabled") => publishedApis.update(organizationId, project.id, kind, api.id, { status }),
    onSuccess: (updated) => {
      toast.success(updated.status === "active" ? `${updated.name} is serving again` : `${updated.name} is disabled`);
      setToggling(false);
      void client.invalidateQueries({ queryKey: apiKeys.list(organizationId, project.id, kind) });
      void client.invalidateQueries({ queryKey: apiKeys.catalog(organizationId) });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <div>
        <Link href={projectHref(project.id, kind, "/apis")} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-3.5" /> APIs
        </Link>
      </div>
      <PageHeader
        title={api.name}
        meta={
          <>
            <StatusBadge status={api.status} />
            <span className="font-mono">{api.slug}</span>
          </>
        }
        actions={
          <>
            <GuardedButton variant="outline" allowed={canWrite} reason={environmentWriteReason(kind)} onClick={() => setEditing(true)}>
              <PencilIcon data-icon="inline-start" /> Edit
            </GuardedButton>
            <GuardedButton
              variant={active ? "outline" : "default"}
              allowed={canWrite}
              reason={environmentWriteReason(kind)}
              onClick={() => setToggling(true)}
            >
              {active ? "Disable" : "Enable"}
            </GuardedButton>
          </>
        }
      />
      {!active ? (
        <Notice tone="warning" title="This API is disabled">
          The gateway refuses every call to it and it is hidden from the organization&apos;s API catalog. Grants are kept.
        </Notice>
      ) : null}

      <Panel title="Properties">
        <DescriptionList
          items={[
            { label: "API ID", value: <IdText value={api.id} /> },
            { label: "Environment", value: kind === "live" ? "Live" : "Test" },
            { label: "Upstream URL", value: <span className="font-mono text-xs break-all">{api.upstreamUrl}</span> },
            {
              label: "Called at",
              value: (
                <span className="font-mono text-xs break-all">
                  /api/v1/apis/{api.id}/<span className="text-muted-foreground">…path</span>
                </span>
              ),
            },
            { label: "Upstream audience", value: <span className="font-mono text-xs break-all">apicenter-api:{api.id}</span> },
            {
              label: "Published",
              value: (
                <span title={formatDateTime(api.createdAt)}>
                  {formatRelative(api.createdAt)}
                  {api.createdBy ? <span className="text-muted-foreground"> by {api.createdBy}</span> : null}
                </span>
              ),
            },
            { label: "Updated", value: <span title={formatDateTime(api.updatedAt)}>{formatRelative(api.updatedAt)}</span> },
          ]}
        />
      </Panel>

      <Panel
        title="Operations"
        description="A request must match one of these by method and path; the application needs the operation's action. Literal segments win over placeholders."
        flush
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Method</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="hidden md:table-cell">Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {api.operations.map((operation) => (
              <TableRow key={`${operation.method} ${operation.path}`}>
                <TableCell className="font-mono text-xs font-medium">{operation.method}</TableCell>
                <TableCell className="font-mono text-xs break-all whitespace-normal">{operation.path}</TableCell>
                <TableCell className="font-mono text-xs">{operation.action}</TableCell>
                <TableCell className="hidden max-w-xs truncate text-muted-foreground md:table-cell">{operation.description || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      <AccessRequestsPanel apis={[api]} />

      <EditApiSheet api={api} open={editing} onOpenChange={setEditing} />
      <ConfirmDialog
        open={toggling}
        onOpenChange={setToggling}
        title={active ? `Disable ${api.name}` : `Enable ${api.name}`}
        description={
          active
            ? "The gateway stops serving it immediately: every call is refused until you enable it again. Grants and access requests are kept."
            : "The gateway serves it again from the next request, to applications that hold a grant."
        }
        confirmLabel={active ? "Disable API" : "Enable API"}
        destructive={active}
        busy={setStatus.isPending}
        onConfirm={() => setStatus.mutate(active ? "disabled" : "active")}
      />
    </>
  );
}
