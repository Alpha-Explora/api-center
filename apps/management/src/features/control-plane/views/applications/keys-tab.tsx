"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { EmptyState } from "@/components/patterns/empty-state";
import { FormRow, NativeSelect } from "@/components/patterns/form";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { Panel } from "@/components/patterns/panel";
import { SecretDialog } from "@/components/patterns/secret-dialog";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDateTime, formatRelative } from "@/lib/format";
import { controlPlane } from "../../data/control-plane-repository";
import { environmentWriteReason } from "../../model/access";
import type { Application, Credential, IssuedCredential } from "../../model/control-plane";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";

const EXPIRY_OPTIONS = [30, 90, 180, 365];

/** Shows a newly issued key exactly once. Only a verifier is stored; it cannot be shown again. */
export function SecretOnce({ credential, onClose }: { credential: IssuedCredential | null; onClose: () => void }) {
  return (
    <SecretDialog
      secret={credential?.secret ?? null}
      title="Copy this key now"
      description="It will not be shown again. Store it as a secret in the application's deployment, as APICENTER_API_KEY."
      details={credential ? <p className="text-xs text-muted-foreground">Expires {formatDateTime(credential.expiresAt)}.</p> : null}
      onClose={onClose}
    />
  );
}

export function KeysTab({ application }: { application: Application }) {
  const { organizationId, project, kind, canWrite } = useProjectEnvironment();
  const client = useQueryClient();
  const key = [...cpKeys.application(organizationId, project.id, kind, application.id), "credentials"];
  const credentials = useQuery({ queryKey: key, queryFn: () => controlPlane.credentials(organizationId, project.id, kind, application.id), retry: false });
  const [issuing, setIssuing] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const [revoking, setRevoking] = useState<Credential | null>(null);
  const issue = useMutation({
    mutationFn: () => controlPlane.issueCredential(organizationId, project.id, kind, application.id, { operationId, expiresInDays }),
    onSuccess: (credential) => {
      setIssuing(false);
      setIssued(credential);
      setOperationId(crypto.randomUUID());
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const revoke = useMutation({
    mutationFn: (input: { id: string; reason: string }) => controlPlane.revokeCredential(organizationId, project.id, kind, application.id, input.id, input.reason),
    onSuccess: () => {
      toast.success("Key revoked");
      setRevoking(null);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const rows = credentials.data ?? [];
  const activeCount = rows.filter((row) => row.status === "active").length;

  return (
    <>
      {application.status !== "active" ? <Notice tone="warning" title="This application is not active">Keys cannot be issued for it.</Notice> : null}
      <Panel
        title={`${kind === "live" ? "Live" : "Test"} keys`}
        description={`Keys start with ak_${kind}_. Issue a new key before revoking the old one to rotate without downtime.`}
        flush
        actions={
          <GuardedButton size="sm" allowed={canWrite} reason={environmentWriteReason(kind)} disabled={application.status !== "active"} onClick={() => setIssuing(true)}>
            <PlusIcon data-icon="inline-start" /> Issue key
          </GuardedButton>
        }
      >
        {credentials.error ? (
          <div className="p-4">
            <ErrorPanel title="Keys could not be loaded" error={credentials.error} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<KeyRoundIcon />} title="No keys issued" description="Issue a key and store it in the application's deployment." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Last used</TableHead>
                <TableHead className="hidden md:table-cell">Expires</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((credential) => (
                <TableRow key={credential.id}>
                  <TableCell className="font-mono text-xs">{credential.lookupPrefix}…</TableCell>
                  <TableCell>
                    <StatusBadge status={credential.status} />
                    {credential.revokedReason ? <span className="ml-2 text-xs text-muted-foreground">{credential.revokedReason}</span> : null}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{credential.lastUsedAt ? formatRelative(credential.lastUsedAt) : "Never"}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell" title={formatDateTime(credential.expiresAt)}>
                    {formatRelative(credential.expiresAt)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{formatRelative(credential.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {credential.status === "active" && canWrite ? (
                      <Button size="sm" variant="ghost" onClick={() => setRevoking(credential)}>
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

      <Dialog open={issuing} onOpenChange={setIssuing}>
        <DialogContent className="sm:max-w-md">
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              issue.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Issue a {kind} key</DialogTitle>
              <DialogDescription>
                For {application.name}. The key is shown once; {activeCount > 0 ? `its ${activeCount} active key${activeCount === 1 ? "" : "s"} keep working.` : "store it right away."}
              </DialogDescription>
            </DialogHeader>
            <FormRow label="Expires after" htmlFor="key-expiry">
              <NativeSelect id="key-expiry" value={String(expiresInDays)} onChange={(event) => setExpiresInDays(Number(event.target.value))}>
                {EXPIRY_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIssuing(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={issue.isPending}>
                {issue.isPending ? "Issuing…" : "Issue key"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <SecretOnce credential={issued} onClose={() => setIssued(null)} />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(next) => !next && setRevoking(null)}
        title={`Revoke ${revoking?.lookupPrefix ?? ""}…`}
        description="Requests with this key are refused immediately. This cannot be undone."
        confirmLabel="Revoke key"
        destructive
        reasonLabel="Reason (kept in the audit log)"
        busy={revoke.isPending}
        onConfirm={(reason) => revoking && revoke.mutate({ id: revoking.id, reason })}
      />
    </>
  );
}
