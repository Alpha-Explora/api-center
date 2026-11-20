"use client";
import { useQuery } from "@tanstack/react-query";
import { SendIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IdText } from "@/components/patterns/copy-button";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorPanel } from "@/components/patterns/notices";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDateTime, formatRelative } from "@/lib/format";
import { publishedApis } from "../../data/published-apis";
import type { Application } from "../../model/control-plane";
import { outgoingForApplication, type OutgoingRequest } from "../../model/outgoing-requests";
import { apiKeys } from "../../view-models/published-apis";
import { useProjectEnvironment } from "../../view-models/project-environment";

export const outgoingRequestsKey = (organizationId: string, projectId: string) => [...apiKeys.accessRequests(organizationId, projectId), "outgoing"] as const;

/** Requests this application sent for other projects' APIs, and what their admins decided. */
export function OutgoingRequestsPanel({ application, projectName }: { application: Application; projectName: (projectId: string) => string }) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const requests = useQuery({
    queryKey: outgoingRequestsKey(organizationId, project.id),
    queryFn: () => publishedApis.outgoingRequests(organizationId, project.id),
    retry: false,
  });
  const rows = outgoingForApplication(requests.data ?? [], application.id, kind);

  return (
    <Panel title="Outgoing requests" description="API access this application asked other projects for. Their admins approve or reject each request." flush>
      {requests.error ? (
        <div className="p-4">
          <ErrorPanel title="Outgoing requests could not be loaded" error={requests.error} />
        </div>
      ) : requests.isLoading ? (
        <div className="flex flex-col gap-2 p-3">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<SendIcon />} title="No outgoing requests" description="Requests for another project's API show up here until they are decided, and afterwards." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Requested by</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((request) => (
              <TableRow key={request.id}>
                <TableCell className="max-w-0 min-w-36">
                  <span className="block font-mono text-xs">{request.action}</span>
                  <span className="block truncate text-xs text-muted-foreground">{apiLabel(request, projectName)}</span>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <StatusBadge status={request.status} />
                  <Decision request={request} />
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{request.requestedBy}</TableCell>
                <TableCell
                  className="hidden text-right text-muted-foreground sm:table-cell"
                  title={formatDateTime(request.decidedAt ?? request.createdAt)}
                >
                  {formatRelative(request.decidedAt ?? request.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

function apiLabel(request: OutgoingRequest, projectName: (projectId: string) => string) {
  if (!request.api) return <IdText value={request.apiId} />;
  return `${request.api.name} · ${projectName(request.api.projectId)}`;
}

function Decision({ request }: { request: OutgoingRequest }) {
  if (request.status === "pending") return <p className="mt-1 text-xs text-muted-foreground">Waiting for the API project&apos;s admins.</p>;
  return (
    <div className="mt-1 max-w-sm text-xs text-muted-foreground">
      {request.decidedBy ? <p>By {request.decidedBy}</p> : null}
      {request.status === "rejected" ? (
        request.rejectionReason ? (
          <p className="break-words text-foreground">&ldquo;{request.rejectionReason}&rdquo;</p>
        ) : (
          <p>No reason given.</p>
        )
      ) : null}
    </div>
  );
}
