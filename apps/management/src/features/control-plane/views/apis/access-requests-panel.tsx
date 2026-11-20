"use client";
import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { InboxIcon } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { IdText } from "@/components/patterns/copy-button";
import { EmptyState } from "@/components/patterns/empty-state";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ErrorPanel } from "@/components/patterns/notices";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { ApiError } from "@/lib/api-center/client-core";
import { formatDateTime, formatRelative } from "@/lib/format";
import { controlPlane } from "../../data/control-plane-repository";
import { publishedApis } from "../../data/published-apis";
import { PROJECT_ADMIN_REASON } from "../../model/access";
import { actorLabelOf, sortAccessRequests, type AccessRequest, type PublishedApi } from "../../model/published-apis";
import { MAX_REJECTION_REASON, rejectionReasonBody } from "../../model/outgoing-requests";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { apiKeys } from "../../view-models/published-apis";
import { cpKeys } from "../../view-models/query-keys";

const SELF_REASON = "You made this request; another project admin has to decide it.";

type Decision = { request: AccessRequest; approve: boolean };

/**
 * Requests from applications in other projects to call this environment's APIs. Only the API project's admins
 * decide them, and never the person who asked.
 */
export function AccessRequestsPanel({ apis, title = "Access requests" }: { apis: PublishedApi[]; title?: string }) {
  const { organizationId, project, kind, canManage } = useProjectEnvironment();
  const client = useQueryClient();
  const key = apiKeys.accessRequests(organizationId, project.id);
  const requests = useQuery({ queryKey: key, queryFn: () => publishedApis.accessRequests(organizationId, project.id) });
  const me = useQuery({ queryKey: cpKeys.me(organizationId), queryFn: () => controlPlane.me(organizationId), staleTime: 60_000 });
  const projects = useQuery({ queryKey: cpKeys.projects(organizationId), queryFn: () => controlPlane.listProjects(organizationId), staleTime: 60_000 });
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");

  const apiNames = new Map(apis.map((api) => [api.id, api.name]));
  const mine = (requests.data ?? []).filter((request) => apiNames.has(request.apiId));
  const { pending, decided } = sortAccessRequests(mine);
  const self = actorLabelOf(me.data);

  // Application names live in the consumer projects; resolve the ones this person can read, else show IDs.
  const consumerProjects = [...new Set(mine.map((request) => request.consumerProjectId))];
  const consumerApplications = useQueries({
    queries: consumerProjects.map((projectId) => ({
      queryKey: cpKeys.applications(organizationId, projectId, kind),
      queryFn: () => controlPlane.applications(organizationId, projectId, kind),
      staleTime: 60_000,
    })),
  });
  const applicationNames = new Map(consumerApplications.flatMap((query) => (query.data ?? []).map((application) => [application.id, application.name] as const)));
  const projectNames = new Map((projects.data ?? []).map((entry) => [entry.id, entry.name]));

  const decide = useMutation({
    mutationFn: ({ request, approve }: Decision) => publishedApis.decide(organizationId, request.id, approve, approve ? undefined : rejectionReasonBody(reason).reason),
    onSuccess: (request) => {
      toast.success(request.status === "approved" ? `Approved ${request.action}` : `Rejected ${request.action}`);
      setDeciding(null);
      setReason("");
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.code === "ACCESS_REQUEST_DECIDED") {
        toast.error("Someone else decided this request already");
        setDeciding(null);
      } else if (error instanceof ApiError && error.code === "SELF_APPROVAL") {
        toast.error(SELF_REASON);
        setDeciding(null);
      } else toast.error(error.message);
    },
    onSettled: (_, __, { request }) => {
      void client.invalidateQueries({ queryKey: key });
      // An approval adds a grant to the requesting application, in its own project.
      void client.invalidateQueries({ queryKey: cpKeys.project(organizationId, request.consumerProjectId) });
      void client.invalidateQueries({ queryKey: cpKeys.approvalsRoot });
    },
  });

  const consumer = (request: AccessRequest) => (
    <div className="flex min-w-0 flex-col">
      <span className="truncate">{applicationNames.get(request.consumerApplicationId) ?? <IdText value={request.consumerApplicationId} />}</span>
      <span className="truncate text-xs text-muted-foreground">{projectNames.get(request.consumerProjectId) ?? request.consumerProjectId}</span>
    </div>
  );
  const target = (request: AccessRequest) => (
    <div className="flex min-w-0 flex-col">
      <span className="font-mono text-xs">{request.action}</span>
      <span className="truncate text-xs text-muted-foreground">{apiNames.get(request.apiId)}</span>
      <span className="truncate text-xs text-muted-foreground sm:hidden">
        for {applicationNames.get(request.consumerApplicationId) ?? request.consumerApplicationId} · {projectNames.get(request.consumerProjectId) ?? request.consumerProjectId}
      </span>
    </div>
  );

  return (
    <>
      <Panel
        title={title}
        description="Applications in other projects ask to call an action. Approving grants it at once. A rejection can carry a reason, which the requesting project sees."
        flush
      >
        {requests.error ? (
          <div className="p-4">
            <ErrorPanel title="Access requests could not be loaded" error={requests.error} />
          </div>
        ) : requests.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-8 w-full" />
          </div>
        ) : mine.length === 0 ? (
          <EmptyState icon={<InboxIcon />} title="No access requests" description="When an application in another project asks to call one of these APIs, the request shows up here." />
        ) : (
          <>
            {pending.length === 0 ? (
              <p className="border-b px-4 py-3 text-[13px] text-muted-foreground">Nothing is waiting for a decision.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead className="hidden sm:table-cell">Requested for</TableHead>
                    <TableHead className="hidden md:table-cell">Requested by</TableHead>
                    <TableHead className="hidden sm:table-cell">Waiting</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((request) => {
                    const ownRequest = request.requestedBy === self;
                    return (
                      <TableRow key={request.id}>
                        <TableCell>{target(request)}</TableCell>
                        <TableCell className="hidden sm:table-cell">{consumer(request)}</TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {request.requestedBy}
                          {ownRequest ? <span className="text-foreground"> (you)</span> : null}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell" title={formatDateTime(request.createdAt)}>
                          {formatRelative(request.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1.5">
                            <GuardedButton
                              size="sm"
                              variant="outline"
                              allowed={canManage && !ownRequest}
                              reason={canManage ? SELF_REASON : PROJECT_ADMIN_REASON}
                              onClick={() => setDeciding({ request, approve: false })}
                            >
                              Reject
                            </GuardedButton>
                            <GuardedButton
                              size="sm"
                              allowed={canManage && !ownRequest}
                              reason={canManage ? SELF_REASON : PROJECT_ADMIN_REASON}
                              onClick={() => setDeciding({ request, approve: true })}
                            >
                              Approve
                            </GuardedButton>
                          </div>
                          {canManage && ownRequest ? <p className="mt-1 text-right text-xs whitespace-normal text-muted-foreground">Your request: another admin decides it.</p> : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {decided.length > 0 ? (
              <>
                <h3 className="border-y bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">Decided</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead className="hidden sm:table-cell">Requested for</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead className="hidden md:table-cell">Decided by</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Decided</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {decided.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell>{target(request)}</TableCell>
                        <TableCell className="hidden sm:table-cell">{consumer(request)}</TableCell>
                        <TableCell className="whitespace-normal">
                          <StatusBadge status={request.status} />
                          {request.rejectionReason ? <p className="mt-1 max-w-xs text-xs break-words text-muted-foreground">{request.rejectionReason}</p> : null}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">{request.decidedBy ?? "—"}</TableCell>
                        <TableCell className="hidden text-right text-muted-foreground sm:table-cell" title={formatDateTime(request.decidedAt)}>
                          {formatRelative(request.decidedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            ) : null}
          </>
        )}
      </Panel>

      <ConfirmDialog
        open={deciding !== null}
        onOpenChange={(next) => {
          if (next) return;
          setDeciding(null);
          setReason("");
        }}
        title={deciding ? `${deciding.approve ? "Approve" : "Reject"} ${deciding.request.action}` : ""}
        description={
          deciding
            ? deciding.approve
              ? `${applicationNames.get(deciding.request.consumerApplicationId) ?? deciding.request.consumerApplicationId} in ${projectNames.get(deciding.request.consumerProjectId) ?? deciding.request.consumerProjectId} can call ${deciding.request.action} on ${apiNames.get(deciding.request.apiId)} from its next request.`
              : `The request is closed without a grant. ${projectNames.get(deciding.request.consumerProjectId) ?? "The requesting project"} sees the reason you give.`
            : undefined
        }
        confirmLabel={deciding?.approve ? "Approve" : "Reject"}
        destructive={deciding?.approve === false}
        busy={decide.isPending}
        onConfirm={() => deciding && decide.mutate(deciding)}
      >
        {deciding && !deciding.approve ? (
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="font-medium">Reason (optional)</span>
            <Textarea
              autoFocus
              rows={3}
              maxLength={MAX_REJECTION_REASON}
              placeholder="For example: use the read-only orders API instead."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
