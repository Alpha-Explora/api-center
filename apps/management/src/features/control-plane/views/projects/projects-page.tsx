"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderPlusIcon, PlusIcon, SearchIcon } from "lucide-react";
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
import { projectHref, matchesQuery } from "@/lib/app-navigation";
import { SLUG_PATTERN, toSlug } from "@/lib/format";
import { controlPlane } from "../../data/control-plane-repository";
import { cpKeys } from "../../view-models/query-keys";
import { LoadMore, usePagedList } from "../../view-models/paged-list";
import { useAccess, useOrganization } from "../../view-models/use-organization";

export function ProjectsPage() {
  const { organizationId, platformAdmin, setOrganizationId, loading } = useOrganization();
  const { access } = useAccess(organizationId);
  const searchParams = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const projects = usePagedList(cpKeys.projects(organizationId ?? "none"), (cursor) => controlPlane.projectsPage(organizationId as string, cursor), {
    enabled: Boolean(organizationId),
  });
  const choosing = platformAdmin && (!organizationId || searchParams.get("organization") === "choose");
  const visible = (projects.items ?? []).filter((project) => matchesQuery(filter, project.name, project.slug, project.id));

  return (
    <>
      <PageHeader
        title="Projects"
        description="A project is one product. Test and live are separate environments with their own applications, grants and keys."
        actions={
          organizationId ? (
            <GuardedButton allowed={access.canCreateProject} reason="Viewers cannot create projects." onClick={() => setCreating(true)}>
              <PlusIcon data-icon="inline-start" /> New project
            </GuardedButton>
          ) : null
        }
      />

      {choosing ? <OrganizationIdForm current={organizationId} onSubmit={setOrganizationId} /> : null}

      {!loading && !organizationId && !platformAdmin ? (
        <EmptyState title="You are not a member of an organization" description="Ask an organization admin to add your email, then sign in again." />
      ) : null}

      {projects.error ? <ErrorPanel title="Projects could not be loaded" error={projects.error} /> : null}

      {organizationId && !projects.error ? (
        <Panel flush>
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <SearchIcon className="size-3.5 text-muted-foreground" />
            <input
              aria-label="Filter projects"
              placeholder="Filter by name, slug or ID"
              className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          {projects.isPending ? (
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<FolderPlusIcon />}
              title={filter ? "No project matches the filter" : "No projects yet"}
              description={filter ? undefined : "Create a project to get a test environment, then add applications and issue keys."}
              action={
                !filter && access.canCreateProject ? (
                  <Button variant="outline" onClick={() => setCreating(true)}>
                    <PlusIcon data-icon="inline-start" /> New project
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
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((project) => (
                  <TableRow key={project.id} className="group">
                    <TableCell>
                      <Link href={projectHref(project.id, "test")} className="font-medium hover:underline">
                        {project.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{project.slug}</TableCell>
                    <TableCell>
                      <StatusBadge status={project.status} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <IdText value={project.id} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={projectHref(project.id, "live")} className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus:opacity-100">
                        Live →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <LoadMore list={projects} />
        </Panel>
      ) : null}

      {organizationId ? <CreateProjectSheet organizationId={organizationId} open={creating} onOpenChange={setCreating} /> : null}
    </>
  );
}

function OrganizationIdForm({ current, onSubmit }: { current: string | undefined; onSubmit: (organizationId: string) => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState(current ?? "");
  return (
    <Panel title="Open an organization" description="Platform operators can act in any organization. Enter its ID.">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          onSubmit(draft.trim());
          router.replace("/projects");
        }}
      >
        <Input aria-label="Organization ID" className="font-mono sm:max-w-md" placeholder="00000000-0000-0000-0000-000000000000" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <Button type="submit" variant="outline" disabled={!draft.trim()}>
          Open
        </Button>
      </form>
    </Panel>
  );
}

function CreateProjectSheet({ organizationId, open, onOpenChange }: { organizationId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const create = useMutation({
    mutationFn: () => controlPlane.createProject(organizationId, { name: name.trim(), slug }),
    onSuccess: (project) => {
      toast.success(`Created ${project.name} with a test environment`);
      void client.invalidateQueries({ queryKey: cpKeys.projects(organizationId) });
      void client.invalidateQueries({ queryKey: cpKeys.me(organizationId) });
      onOpenChange(false);
      setName("");
      setSlug("");
      setSlugEdited(false);
      router.push(projectHref(project.id, "test"));
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
            <SheetTitle>New project</SheetTitle>
            <SheetDescription>Creates the project and its test environment. You become its administrator.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">
            <FormRow label="Name" htmlFor="project-name">
              <Input
                id="project-name"
                autoFocus
                placeholder="Serbizio"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!slugEdited) setSlug(toSlug(event.target.value));
                }}
              />
            </FormRow>
            <FormRow
              label="Slug"
              htmlFor="project-slug"
              hint="Lowercase letters, numbers and dashes. Cannot be changed later."
              error={slug && !slugValid ? "Use lowercase letters, numbers and dashes, starting and ending with a letter or number." : undefined}
            >
              <Input
                id="project-slug"
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
              {create.isPending ? "Creating…" : "Create project"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
