"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppWindowIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IdText } from "@/components/patterns/copy-button";
import { EmptyState } from "@/components/patterns/empty-state";
import { FormRow } from "@/components/patterns/form";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ErrorPanel } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { projectHref } from "@/lib/app-navigation";
import { SLUG_PATTERN, toSlug } from "@/lib/format";
import { controlPlane } from "../../data/control-plane-repository";
import { environmentWriteReason } from "../../model/access";
import { RequireEnvironment, useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";
import { RelativeTime } from "@/components/patterns/relative-time";
import { LinkRow } from "@/components/patterns/link-row";
import type { Application } from "../../model/control-plane";

export function ApplicationsPage() {
  return (
    <RequireEnvironment>
      <ApplicationsList />
    </RequireEnvironment>
  );
}

function ApplicationsList() {
  const { organizationId, project, kind, canWrite } = useProjectEnvironment();
  const [creating, setCreating] = useState(false);
  const applications = useQuery({
    queryKey: cpKeys.applications(organizationId, project.id, kind),
    queryFn: () => controlPlane.applications(organizationId, project.id, kind),
  });
  const catalog = useQuery({ queryKey: cpKeys.catalog, queryFn: controlPlane.capabilities, staleTime: 5 * 60_000 });
  const capabilityName = (id: string) => catalog.data?.find((capability) => capability.id === id)?.name ?? id;

  return (
    <>
      <PageHeader
        title="Applications"
        description={`Each backend, worker or integration gets its own identity, explicit grants and ${kind} keys.`}
        actions={
          <GuardedButton allowed={canWrite} reason={environmentWriteReason(kind)} onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" /> New application
          </GuardedButton>
        }
      />
      {applications.error ? <ErrorPanel title="Applications could not be loaded" error={applications.error} /> : null}
      <Panel flush>
        {applications.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (applications.data ?? []).length === 0 ? (
          <EmptyState
            icon={<AppWindowIcon />}
            title={`No ${kind} applications`}
            description="Add an application for each service that calls APICenter, then grant it actions and issue a key."
            action={
              canWrite ? (
                <Button variant="outline" onClick={() => setCreating(true)}>
                  <PlusIcon data-icon="inline-start" /> New application
                </Button>
              ) : null
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Application</TableHead>
                <TableHead className="hidden md:table-cell">Access</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Keys</TableHead>
                <TableHead className="hidden sm:table-cell">Last used</TableHead>
                <TableHead className="hidden xl:table-cell">ID</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(applications.data ?? []).map((application) => {
                const href = projectHref(project.id, kind, `/applications/${application.id}`);
                return (
                  <LinkRow key={application.id} href={href}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link href={href} className="font-medium hover:underline">
                          {application.name}
                        </Link>
                        {application.status !== "active" ? <StatusBadge status={application.status} /> : null}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">{application.slug}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <ApplicationAccess application={application} capabilityName={capabilityName} />
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {application.activeKeys === undefined ? "—" : application.activeKeys === 0 ? <span className="text-muted-foreground">None</span> : application.activeKeys}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {application.lastUsedAt ? <RelativeTime value={application.lastUsedAt} /> : application.activeKeys === undefined ? "—" : "Never"}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <IdText value={application.id} />
                    </TableCell>
                  </LinkRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Panel>
      <CreateApplicationSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}

function CreateApplicationSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const client = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const create = useMutation({
    mutationFn: () => controlPlane.createApplication(organizationId, project.id, kind, { name: name.trim(), slug }),
    onSuccess: (application) => {
      toast.success(`Added ${application.name}`);
      void client.invalidateQueries({ queryKey: cpKeys.applications(organizationId, project.id, kind) });
      onOpenChange(false);
      setName("");
      setSlug("");
      setSlugEdited(false);
      router.push(projectHref(project.id, kind, `/applications/${application.id}`));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const slugValid = SLUG_PATTERN.test(slug);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <form
          className="flex h-full flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <SheetHeader>
            <SheetTitle>New {kind} application</SheetTitle>
            <SheetDescription>An identity for one service. It has no access until you grant actions.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">
            <FormRow label="Name" htmlFor="application-name">
              <Input
                id="application-name"
                autoFocus
                placeholder="API server"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!slugEdited) setSlug(toSlug(event.target.value));
                }}
              />
            </FormRow>
            <FormRow label="Slug" htmlFor="application-slug" hint="Unique in this environment." error={slug && !slugValid ? "Use lowercase letters, numbers and dashes." : undefined}>
              <Input
                id="application-slug"
                className="font-mono"
                value={slug}
                aria-invalid={Boolean(slug) && !slugValid}
                onChange={(event) => {
                  setSlugEdited(true);
                  setSlug(event.target.value);
                }}
              />
            </FormRow>
          </div>
          <SheetFooter className="mt-auto flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !slugValid || create.isPending}>
              {create.isPending ? "Adding…" : "Add application"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** What an application may call: its granted capabilities by name, or a nudge when it has no grants yet. */
function ApplicationAccess({ application, capabilityName }: { application: Application; capabilityName: (id: string) => string }) {
  if (application.activeGrants === undefined) return <span className="text-muted-foreground">—</span>;
  if (application.activeGrants === 0) return <span className="text-xs text-warning">No actions granted yet</span>;
  const names = (application.capabilities ?? []).map(capabilityName);
  const shown = names.slice(0, 3);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((name) => (
        <span key={name} className="inline-flex h-5 items-center rounded-sm bg-muted px-1.5 text-xs">
          {name}
        </span>
      ))}
      {names.length > shown.length ? <span className="text-xs text-muted-foreground">+{names.length - shown.length}</span> : null}
      <span className="text-xs text-muted-foreground">
        · {application.activeGrants} action{application.activeGrants === 1 ? "" : "s"}
      </span>
    </div>
  );
}
