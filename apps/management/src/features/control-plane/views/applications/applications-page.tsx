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
import { SLUG_PATTERN, formatRelative, toSlug } from "@/lib/format";
import { controlPlane } from "../../data/control-plane-repository";
import { environmentWriteReason } from "../../model/access";
import { RequireEnvironment, useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";

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
    retry: false,
  });

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
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">ID</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(applications.data ?? []).map((application) => (
                <TableRow key={application.id}>
                  <TableCell>
                    <Link href={projectHref(project.id, kind, `/applications/${application.id}`)} className="font-medium hover:underline">
                      {application.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{application.slug}</TableCell>
                  <TableCell>
                    <StatusBadge status={application.status} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <IdText value={application.id} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{formatRelative(application.createdAt)}</TableCell>
                </TableRow>
              ))}
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
