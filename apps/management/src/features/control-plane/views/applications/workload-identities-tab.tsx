"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FingerprintIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { EmptyState } from "@/components/patterns/empty-state";
import { FormRow } from "@/components/patterns/form";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { ApiError } from "@/lib/api-center/client-core";
import { formatDateTime, formatRelative } from "@/lib/format";
import { workloadBindings } from "../../data/workload-bindings";
import { environmentWriteReason } from "../../model/access";
import type { Application } from "../../model/control-plane";
import { workloadBindingFormToBody, type WorkloadBinding, type WorkloadBindingBody, type WorkloadBindingErrors, type WorkloadBindingForm } from "../../model/workload-bindings";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";

export function WorkloadIdentitiesTab({ application }: { application: Application }) {
  const { organizationId, project, kind, canWrite } = useProjectEnvironment();
  const client = useQueryClient();
  const key = [...cpKeys.application(organizationId, project.id, kind, application.id), "workload-bindings"];
  const bindings = useQuery({ queryKey: key, queryFn: () => workloadBindings.list(organizationId, project.id, kind, application.id), retry: false });
  const [binding, setBinding] = useState(false);
  const [revoking, setRevoking] = useState<WorkloadBinding | null>(null);
  const revoke = useMutation({
    mutationFn: (target: WorkloadBinding) => workloadBindings.revoke(organizationId, project.id, kind, application.id, target.id),
    onSuccess: () => {
      toast.success("Workload identity revoked");
      setRevoking(null);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const rows = bindings.data ?? [];

  return (
    <>
      <Panel
        title="Workload identities"
        description={`A bound Google service account can call APICenter as ${application.name} with a Google-signed ID token as its bearer token instead of an API key; the gateway verifies the token with Google, matches its subject and audience to an active binding, and applies this application's grants and quotas.`}
        flush
        actions={
          <GuardedButton size="sm" allowed={canWrite} reason={environmentWriteReason(kind)} disabled={application.status !== "active"} onClick={() => setBinding(true)}>
            <PlusIcon data-icon="inline-start" /> Bind service account
          </GuardedButton>
        }
      >
        {bindings.error ? (
          <div className="p-4">
            <ErrorPanel title="Workload identities could not be loaded" error={bindings.error} />
          </div>
        ) : bindings.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-8 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FingerprintIcon />}
            title="No workload identities"
            description="Bind a Google service account, such as a Cloud Run service's, so it needs no stored API key."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service account</TableHead>
                <TableHead className="hidden md:table-cell">Audience</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-0 min-w-32">
                    <div className="truncate font-mono text-xs" title={row.subject}>
                      {row.subject}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{row.description ?? "No description"}</div>
                  </TableCell>
                  <TableCell className="hidden max-w-64 md:table-cell">
                    <span className="block truncate font-mono text-xs text-muted-foreground" title={row.audience}>
                      {row.audience}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                    {row.revokedAt ? (
                      <span className="ml-2 hidden text-xs text-muted-foreground sm:inline" title={`${formatDateTime(row.revokedAt)}${row.revokedBy ? ` by ${row.revokedBy}` : ""}`}>
                        {formatRelative(row.revokedAt)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell" title={`${formatDateTime(row.createdAt)} by ${row.createdBy}`}>
                    {formatRelative(row.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.status === "active" && canWrite ? (
                      <Button size="sm" variant="ghost" onClick={() => setRevoking(row)}>
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <BindSheet application={application} open={binding} onOpenChange={setBinding} onBound={() => void client.invalidateQueries({ queryKey: key })} />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(next) => !next && setRevoking(null)}
        title={`Revoke service account ${revoking?.subject ?? ""}`}
        description={`Its ID tokens are refused for ${application.name} from the next request. Revoking cannot be undone, but you can bind the service account again.`}
        confirmLabel="Revoke"
        destructive
        busy={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
    </>
  );
}

const EMPTY: WorkloadBindingForm = { subject: "", audience: "", description: "" };

function BindSheet({
  application,
  open,
  onOpenChange,
  onBound,
}: {
  application: Application;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBound: () => void;
}) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const [form, setForm] = useState<WorkloadBindingForm>(EMPTY);
  const [errors, setErrors] = useState<WorkloadBindingErrors>({});
  const bind = useMutation({
    mutationFn: (body: WorkloadBindingBody) => workloadBindings.bind(organizationId, project.id, kind, application.id, body),
    onSuccess: () => {
      toast.success(`Bound service account to ${application.name}`);
      close(false);
      onBound();
    },
  });
  const conflict = bind.error instanceof ApiError && bind.error.status === 409;

  function close(next: boolean) {
    if (!next) {
      setForm(EMPTY);
      setErrors({});
      bind.reset();
    }
    onOpenChange(next);
  }

  const set = (patch: Partial<WorkloadBindingForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    bind.reset();
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="sm:max-w-md">
        <form
          className="flex h-full flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const result = workloadBindingFormToBody(form);
            setErrors(result.ok ? {} : result.errors);
            if (result.ok) bind.mutate(result.body);
          }}
        >
          <SheetHeader>
            <SheetTitle>Bind a Google service account</SheetTitle>
            <SheetDescription>
              Its ID tokens will authenticate as {application.name} in {kind}. Only Google-issued tokens are accepted.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 overflow-y-auto px-4">
            <FormRow
              label="Unique ID"
              htmlFor="workload-subject"
              error={errors.subject}
              hint={
                <>
                  The service account&apos;s numeric unique ID (the <span className="font-mono">sub</span> of its ID tokens), not its email. Find it with{" "}
                  <span className="font-mono break-all">gcloud iam service-accounts describe EMAIL --format=&quot;value(uniqueId)&quot;</span>.
                </>
              }
            >
              <Input
                id="workload-subject"
                autoFocus
                inputMode="numeric"
                placeholder="104729384756102938475"
                className="font-mono"
                aria-invalid={Boolean(errors.subject)}
                value={form.subject}
                onChange={(event) => set({ subject: event.target.value })}
              />
            </FormRow>
            <FormRow
              label="Audience"
              htmlFor="workload-audience"
              error={errors.audience}
              hint="The audience the workload requests its ID token for. It must exactly match one of the audiences this gateway accepts (its CONTROL_PLANE_WORKLOAD_AUDIENCES setting). The console cannot list them; ask your gateway operator."
            >
              <Input
                id="workload-audience"
                placeholder="https://api.example.com"
                className="font-mono"
                aria-invalid={Boolean(errors.audience)}
                value={form.audience}
                onChange={(event) => set({ audience: event.target.value })}
              />
            </FormRow>
            <FormRow label="Description (optional)" htmlFor="workload-description" error={errors.description} hint="For example the service that uses it.">
              <Textarea id="workload-description" rows={2} maxLength={200} value={form.description} onChange={(event) => set({ description: event.target.value })} />
            </FormRow>
            {conflict ? (
              <Notice tone="warning" title="This service account is already bound">
                It already has an active binding for this audience, on this or another application. Revoke that binding first.
              </Notice>
            ) : bind.error ? (
              <ErrorPanel title="The service account could not be bound" error={bind.error} />
            ) : null}
          </div>
          <SheetFooter className="mt-auto flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={bind.isPending}>
              {bind.isPending ? "Binding…" : "Bind service account"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
