"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, WaypointsIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { IdText } from "@/components/patterns/copy-button";
import { EmptyState } from "@/components/patterns/empty-state";
import { FormRow, NativeSelect } from "@/components/patterns/form";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { Panel } from "@/components/patterns/panel";
import { formatRelative } from "@/lib/format";
import { controlPlane } from "../../data/control-plane-repository";
import { publishedApis } from "../../data/published-apis";
import { environmentWriteReason } from "../../model/access";
import type { Application, Grant } from "../../model/control-plane";
import { apiActions, type CatalogApi } from "../../model/published-apis";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { apiKeys } from "../../view-models/published-apis";
import { cpKeys } from "../../view-models/query-keys";
import { grantsKey } from "./access-tab";
import { OutgoingRequestsPanel, outgoingRequestsKey } from "./outgoing-requests-panel";

/** API actions this application holds, and requests for more from the organization's API catalog. */
export function ApiAccessPanel({ application }: { application: Application }) {
  const { organizationId, project, kind, canWrite } = useProjectEnvironment();
  const client = useQueryClient();
  const key = grantsKey(organizationId, project.id, kind, application.id);
  const grants = useQuery({ queryKey: key, queryFn: () => controlPlane.grants(organizationId, project.id, kind, application.id), retry: false });
  const catalog = useQuery({ queryKey: apiKeys.catalog(organizationId), queryFn: () => publishedApis.catalog(organizationId), retry: false });
  const projects = useQuery({ queryKey: cpKeys.projects(organizationId), queryFn: () => controlPlane.listProjects(organizationId), retry: false, staleTime: 60_000 });
  const [requesting, setRequesting] = useState(false);
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const revoke = useMutation({
    mutationFn: (grantId: string) => controlPlane.revokeGrant(organizationId, project.id, kind, application.id, grantId),
    onSuccess: () => {
      toast.success("API access revoked");
      setRevoking(null);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const apis = new Map((catalog.data ?? []).map((api) => [api.id, api]));
  const projectNames = new Map((projects.data ?? []).map((entry) => [entry.id, entry.name]));
  const available = (catalog.data ?? []).filter((api) => api.environmentKind === kind);
  const active = (grants.data ?? []).filter((grant) => grant.status === "active" && grant.targetKind === "api");
  const apiName = (apiId: string | undefined) => (apiId ? apis.get(apiId)?.name : undefined);

  return (
    <>
      <Panel
        title="API access"
        description="Actions on APIs that projects in this organization publish. Your project's APIs are granted at once; another project's admins approve requests for theirs."
        flush
        actions={
          <GuardedButton size="sm" variant="outline" allowed={canWrite} reason={environmentWriteReason(kind)} onClick={() => setRequesting(true)}>
            <PlusIcon data-icon="inline-start" /> Request API access
          </GuardedButton>
        }
      >
        {grants.error ? (
          <div className="p-4">
            <ErrorPanel title="Grants could not be loaded" error={grants.error} />
          </div>
        ) : grants.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : active.length === 0 ? (
          <EmptyState icon={<WaypointsIcon />} title="No API access" description="This application cannot call any published API yet." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>API</TableHead>
                <TableHead className="hidden md:table-cell">Published by</TableHead>
                <TableHead className="hidden sm:table-cell">Granted</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((grant) => {
                const api = grant.apiId ? apis.get(grant.apiId) : undefined;
                return (
                  <TableRow key={grant.id}>
                    <TableCell className="font-mono text-xs">{grant.action}</TableCell>
                    <TableCell>
                      {api ? (
                        api.name
                      ) : (
                        <span className="flex flex-col">
                          <IdText value={grant.apiId ?? "—"} />
                          {catalog.data ? <span className="text-xs text-muted-foreground">Not in the catalog; it may be disabled.</span> : null}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{api ? (projectNames.get(api.projectId) ?? api.projectId) : "—"}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{formatRelative(grant.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {canWrite ? (
                        <Button size="sm" variant="ghost" onClick={() => setRevoking(grant)}>
                          Revoke
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Panel>

      <OutgoingRequestsPanel application={application} projectName={(id) => projectNames.get(id) ?? id} />

      <RequestApiSheet
        application={application}
        open={requesting}
        onOpenChange={setRequesting}
        apis={available}
        catalogError={catalog.error}
        granted={new Set(active.map((grant) => `${grant.apiId} ${grant.action}`))}
        projectName={(id) => projectNames.get(id) ?? id}
        onRequested={() => void client.invalidateQueries({ queryKey: outgoingRequestsKey(organizationId, project.id) })}
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(next) => !next && setRevoking(null)}
        title={`Revoke ${revoking?.action ?? ""}`}
        description={`${application.name} will be refused ${revoking?.action ?? "this action"} on ${apiName(revoking?.apiId) ?? "this API"} from its next request. ${
          revoking?.apiId && apis.get(revoking.apiId)?.projectId === project.id
            ? "You can grant it again at any time."
            : "Getting it back needs a new request that the API's project approves."
        }`}
        confirmLabel="Revoke"
        destructive
        busy={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </>
  );
}

function RequestApiSheet({
  application,
  open,
  onOpenChange,
  apis,
  catalogError,
  granted,
  projectName,
  onRequested,
}: {
  application: Application;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apis: CatalogApi[];
  catalogError: Error | null;
  granted: Set<string>;
  projectName: (projectId: string) => string;
  onRequested: () => void;
}) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const client = useQueryClient();
  const [apiId, setApiId] = useState("");
  const [action, setAction] = useState("");
  const api = apis.find((entry) => entry.id === apiId);
  const actions = api ? apiActions(api) : [];
  const sameProject = api?.projectId === project.id;
  const request = useMutation({
    mutationFn: (input: { api: CatalogApi; action: string }) =>
      publishedApis.requestAccess(organizationId, project.id, kind, application.id, { apiId: input.api.id, action: input.action }),
    onSuccess: (outcome, input) => {
      if (outcome.kind === "granted") {
        toast.success(`Granted ${input.action} on ${input.api.name}`);
        void client.invalidateQueries({ queryKey: grantsKey(organizationId, project.id, kind, application.id) });
      } else {
        const owner = projectName(input.api.projectId);
        toast.success(`Requested: an admin of ${owner} must approve`);
        onRequested();
      }
      setApiId("");
      setAction("");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <form
          className="flex h-full min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (api && action) request.mutate({ api, action });
          }}
        >
          <SheetHeader>
            <SheetTitle>Request API access</SheetTitle>
            <SheetDescription>
              For {application.name} in {kind}. Only active {kind} APIs in this organization are listed.
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
            {catalogError ? <ErrorPanel title="The API catalog could not be loaded" error={catalogError} /> : null}
            {!catalogError && apis.length === 0 ? (
              <Notice title={`No ${kind} APIs are published`}>
                A project publishes APIs from its APIs section.{" "}
                <Link href="/apis" className="font-medium text-foreground hover:underline">
                  Open the API catalog
                </Link>
              </Notice>
            ) : null}
            <FormRow label="API" htmlFor="request-api">
              <NativeSelect
                id="request-api"
                value={apiId}
                disabled={apis.length === 0}
                onChange={(event) => {
                  setApiId(event.target.value);
                  setAction("");
                }}
              >
                <option value="">Choose an API</option>
                {apis.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} · {projectName(entry.projectId)}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            <FormRow label="Action" htmlFor="request-action">
              <NativeSelect id="request-action" value={action} disabled={!api} onChange={(event) => setAction(event.target.value)}>
                <option value="">{api ? "Choose an action" : "Choose an API first"}</option>
                {actions.map((entry) => (
                  <option key={entry} value={entry} disabled={granted.has(`${api?.id} ${entry}`)}>
                    {entry}
                    {granted.has(`${api?.id} ${entry}`) ? " (granted)" : ""}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            {api && action ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Operations this allows</span>
                <ul className="flex flex-col gap-1 rounded-md border bg-muted/30 p-2.5 font-mono text-xs">
                  {api.operations
                    .filter((operation) => operation.action === action)
                    .map((operation) => (
                      <li key={`${operation.method} ${operation.path}`} className="break-all">
                        <span className="font-medium">{operation.method}</span> {operation.path}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
            {api ? (
              <Notice>
                {sameProject
                  ? "This API belongs to this project, so the action is granted at once."
                  : `This API belongs to ${projectName(api.projectId)}. Sending creates a request that an admin of that project must approve; no reason is recorded either way.`}
              </Notice>
            ) : null}
          </div>
          <SheetFooter className="flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!api || !action || request.isPending}>
              {request.isPending ? "Sending…" : sameProject ? "Grant" : "Send request"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
