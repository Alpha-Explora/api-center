"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, ShieldIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { EmptyState } from "@/components/patterns/empty-state";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { Panel } from "@/components/patterns/panel";
import { projectHref } from "@/lib/app-navigation";

import { controlPlane } from "../../data/control-plane-repository";
import { environmentWriteReason } from "../../model/access";
import type { Application, Grant } from "../../model/control-plane";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";
import { ApiAccessPanel } from "./api-access-panel";
import { RelativeTime } from "@/components/patterns/relative-time";

export function grantsKey(organizationId: string, projectId: string, kind: "test" | "live", applicationId: string) {
  return [...cpKeys.application(organizationId, projectId, kind, applicationId), "grants"] as const;
}

/** Capability and API actions this application may call. Enabling a capability grants nothing by itself. */
export function AccessTab({ application }: { application: Application }) {
  const { organizationId, project, kind, environment, canWrite } = useProjectEnvironment();
  const client = useQueryClient();
  const key = grantsKey(organizationId, project.id, kind, application.id);
  const grants = useQuery({ queryKey: key, queryFn: () => controlPlane.grants(organizationId, project.id, kind, application.id) });
  const catalog = useQuery({ queryKey: cpKeys.catalog, queryFn: controlPlane.capabilities, staleTime: 5 * 60_000 });
  const [granting, setGranting] = useState(false);
  // One grant, or every grant of one capability.
  const [revoking, setRevoking] = useState<{ label: string; grants: Grant[] } | null>(null);
  // Capabilities whose actions are folded away; large grant lists start folded.
  const [folded, setFolded] = useState<Set<string> | null>(null);
  const revoke = useMutation({
    mutationFn: async (targets: Grant[]) => {
      for (const grant of targets) await controlPlane.revokeGrant(organizationId, project.id, kind, application.id, grant.id);
      return targets.length;
    },
    onSuccess: (count) => {
      toast.success(count === 1 ? "Access revoked" : `Revoked ${count} actions`);
      setRevoking(null);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => {
      // Some may have been revoked before the failure; show what is left.
      void client.invalidateQueries({ queryKey: key });
      toast.error(error.message);
    },
  });

  const enabled = new Set(environment?.capabilities.filter((entry) => entry.status === "enabled").map((entry) => entry.capability));
  const active = (grants.data ?? []).filter((grant) => grant.status === "active" && grant.targetKind !== "api");
  const descriptions = new Map((catalog.data ?? []).flatMap((capability) => capability.actions.map((action) => [action.action, action.description] as const)));
  const capabilityNames = new Map((catalog.data ?? []).map((capability) => [capability.id, capability.name]));
  const groups = groupGrants(active, (id) => capabilityNames.get(id) ?? id);
  const isFolded = (capability: string) => (folded ?? (active.length > 12 ? new Set(groups.map((group) => group.capability)) : new Set<string>())).has(capability);
  const toggle = (capability: string) =>
    setFolded((current) => {
      const next = new Set(current ?? (active.length > 12 ? groups.map((group) => group.capability) : []));
      if (next.has(capability)) next.delete(capability);
      else next.add(capability);
      return next;
    });

  return (
    <>
      {enabled.size === 0 ? (
        <Notice
          title="No capabilities are enabled"
          action={
            <Link href={projectHref(project.id, kind, "/capabilities")} className="text-xs font-medium text-foreground hover:underline">
              Enable capabilities
            </Link>
          }
        >
          Enable a capability in this environment before granting its actions.
        </Notice>
      ) : null}
      <Panel
        title="Capability access"
        description="Each action must be granted explicitly. Revoking takes effect on the next request."
        flush
        actions={
          <GuardedButton size="sm" variant="outline" allowed={canWrite} reason={environmentWriteReason(kind)} disabled={enabled.size === 0} onClick={() => setGranting(true)}>
            <PlusIcon data-icon="inline-start" /> Grant actions
          </GuardedButton>
        }
      >
        {grants.error ? (
          <div className="p-4">
            <ErrorPanel title="Grants could not be loaded" error={grants.error} />
          </div>
        ) : active.length === 0 ? (
          <EmptyState icon={<ShieldIcon />} title="No access granted" description="This application cannot call any capability yet." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead className="hidden md:table-cell">Description</TableHead>
                <TableHead className="hidden sm:table-cell">Granted</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const open = !isFolded(group.capability);
                return [
                  <TableRow key={`group-${group.capability}`} className="bg-muted/40 hover:bg-muted/60">
                    <TableCell colSpan={3}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggle(group.capability)}
                        className="flex items-center gap-1.5 text-left font-medium"
                      >
                        {open ? <ChevronDownIcon className="size-3.5 text-muted-foreground" /> : <ChevronRightIcon className="size-3.5 text-muted-foreground" />}
                        {group.name}
                        <span className="font-normal text-muted-foreground">
                          · {group.grants.length} action{group.grants.length === 1 ? "" : "s"}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      {canWrite && group.grants.length > 1 ? (
                        <Button size="sm" variant="quiet-destructive" onClick={() => setRevoking({ label: `all ${group.name} actions`, grants: group.grants })}>
                          Revoke all
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>,
                  ...(open
                    ? group.grants.map((grant) => (
                        <TableRow key={grant.id}>
                          <TableCell className="pl-8 font-mono text-xs">{grant.action}</TableCell>
                          <TableCell className="hidden max-w-sm truncate text-muted-foreground md:table-cell">{descriptions.get(grant.action) ?? "—"}</TableCell>
                          <TableCell className="hidden text-muted-foreground sm:table-cell">
                            <RelativeTime value={grant.createdAt} />
                          </TableCell>
                          <TableCell className="text-right">
                            {canWrite ? (
                              <Button size="sm" variant="quiet-destructive" onClick={() => setRevoking({ label: grant.action, grants: [grant] })}>
                                Revoke
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))
                    : []),
                ];
              })}
            </TableBody>
          </Table>
        )}
      </Panel>

      <ApiAccessPanel application={application} />

      <GrantSheet application={application} open={granting} onOpenChange={setGranting} granted={new Set(active.map((grant) => grant.action))} enabled={enabled} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(next) => !next && setRevoking(null)}
        title={`Revoke ${revoking?.label ?? ""}`}
        description={
          revoking && revoking.grants.length > 1
            ? `${application.name} will be refused these ${revoking.grants.length} actions from its next request.`
            : `${application.name} will be refused this action from its next request.`
        }
        confirmLabel={revoking && revoking.grants.length > 1 ? `Revoke ${revoking.grants.length} actions` : "Revoke"}
        destructive
        busy={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.grants)}
      />
    </>
  );
}

function GrantSheet({
  application,
  open,
  onOpenChange,
  granted,
  enabled,
}: {
  application: Application;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  granted: Set<string>;
  enabled: Set<string | undefined>;
}) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const client = useQueryClient();
  const catalog = useQuery({ queryKey: cpKeys.catalog, queryFn: controlPlane.capabilities, staleTime: 5 * 60_000 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const grant = useMutation({
    mutationFn: async (entries: { capability: string; action: string }[]) => {
      for (const entry of entries) await controlPlane.grant(organizationId, project.id, kind, application.id, entry);
    },
    onSuccess: (_, entries) => {
      toast.success(entries.length === 1 ? `Granted ${entries[0].action}` : `Granted ${entries.length} actions`);
      setSelected(new Set());
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => client.invalidateQueries({ queryKey: grantsKey(organizationId, project.id, kind, application.id) }),
  });
  const capabilities = (catalog.data ?? []).filter((capability) => enabled.has(capability.id));

  function toggle(action: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(action)) next.delete(action);
      else next.add(action);
      return next;
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <form
          className="flex h-full min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const entries = capabilities.flatMap((capability) =>
              capability.actions.filter((action) => selected.has(action.action)).map((action) => ({ capability: capability.id, action: action.action })),
            );
            grant.mutate(entries);
          }}
        >
          <SheetHeader>
            <SheetTitle>Grant actions</SheetTitle>
            <SheetDescription>
              {application.name} in {kind}. Only capabilities enabled in this environment are listed.
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
            {capabilities.map((capability) => (
              <fieldset key={capability.id} className="flex flex-col gap-1">
                <legend className="mb-1 text-xs font-medium text-muted-foreground">{capability.name}</legend>
                {capability.actions.map((action) => {
                  const already = granted.has(action.action);
                  return (
                    <label key={action.action} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted has-disabled:cursor-default has-disabled:opacity-60">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-3.5 accent-foreground"
                        disabled={already}
                        checked={already || selected.has(action.action)}
                        onChange={() => toggle(action.action)}
                      />
                      <span className="min-w-0">
                        <span className="block font-mono text-xs">{action.action}</span>
                        <span className="block text-xs text-muted-foreground">{already ? "Already granted" : action.description}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
          <SheetFooter className="flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={selected.size === 0 || grant.isPending}>
              {grant.isPending ? "Granting…" : selected.size > 1 ? `Grant ${selected.size} actions` : "Grant"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Grants grouped by capability, by capability name, actions in order. */
export function groupGrants(grants: Grant[], nameOf: (capability: string) => string) {
  const groups = new Map<string, Grant[]>();
  for (const grant of grants) {
    const capability = grant.capability ?? grant.action.split(":")[0];
    groups.set(capability, [...(groups.get(capability) ?? []), grant]);
  }
  return [...groups.entries()]
    .map(([capability, entries]) => ({ capability, name: nameOf(capability), grants: [...entries].sort((left, right) => left.action.localeCompare(right.action)) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
