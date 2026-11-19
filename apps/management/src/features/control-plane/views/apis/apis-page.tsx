"use client";
import { useState } from "react";
import Link from "next/link";
import { PlusIcon, WaypointsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/patterns/empty-state";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ErrorPanel } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { projectHref } from "@/lib/app-navigation";
import { formatRelative } from "@/lib/format";
import { environmentWriteReason } from "../../model/access";
import { upstreamHost } from "../../model/published-apis";
import { RequireEnvironment, useProjectEnvironment } from "../../view-models/project-environment";
import { useEnvironmentApis } from "../../view-models/published-apis";
import { AccessRequestsPanel } from "./access-requests-panel";
import { PublishApiSheet } from "./api-sheet";

export function ApisPage() {
  return (
    <RequireEnvironment>
      <ApisList />
    </RequireEnvironment>
  );
}

function ApisList() {
  const { project, kind, canWrite } = useProjectEnvironment();
  const [publishing, setPublishing] = useState(false);
  const apis = useEnvironmentApis();
  const rows = apis.data ?? [];

  return (
    <>
      <PageHeader
        title="APIs"
        description={`HTTP APIs this project publishes through APICenter. Applications in the organization call them with ${kind} keys, one granted action per operation.`}
        actions={
          <GuardedButton allowed={canWrite} reason={environmentWriteReason(kind)} onClick={() => setPublishing(true)}>
            <PlusIcon data-icon="inline-start" /> Publish API
          </GuardedButton>
        }
      />
      {apis.error ? (
        <ErrorPanel title="APIs could not be loaded" error={apis.error} />
      ) : (
        <Panel flush>
          {apis.isLoading ? (
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<WaypointsIcon />}
              title={`No ${kind} APIs published`}
              description="Publish an API to let applications in this organization call it with their keys. You declare its operations and the action each one needs."
              action={
                canWrite ? (
                  <Button variant="outline" onClick={() => setPublishing(true)}>
                    <PlusIcon data-icon="inline-start" /> Publish API
                  </Button>
                ) : null
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Upstream</TableHead>
                  <TableHead className="text-right">Operations</TableHead>
                  <TableHead className="hidden lg:table-cell">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((api) => (
                  <TableRow key={api.id}>
                    <TableCell>
                      <Link href={projectHref(project.id, kind, `/apis/${api.id}`)} className="font-medium hover:underline">
                        {api.name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{api.slug}</TableCell>
                    <TableCell>
                      <StatusBadge status={api.status} />
                    </TableCell>
                    <TableCell className="hidden max-w-56 truncate font-mono text-xs text-muted-foreground md:table-cell">{upstreamHost(api.upstreamUrl)}</TableCell>
                    <TableCell className="text-right tabular-nums">{api.operations.length}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{formatRelative(api.updatedAt ?? api.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      )}
      {rows.length > 0 ? <AccessRequestsPanel apis={rows} /> : null}
      <PublishApiSheet open={publishing} onOpenChange={setPublishing} />
    </>
  );
}
