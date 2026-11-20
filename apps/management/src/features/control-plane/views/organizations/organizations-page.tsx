"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2Icon, MoreHorizontalIcon, PlusIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { IdText } from "@/components/patterns/copy-button";
import { EmptyState } from "@/components/patterns/empty-state";
import { FormRow } from "@/components/patterns/form";
import { ErrorPanel } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { PlatformAdminOnly } from "@/components/platform-admin-only";
import { ApiError } from "@/lib/api-center/client-core";
import { matchesQuery } from "@/lib/app-navigation";
import { formatNumber, SLUG_PATTERN, toSlug } from "@/lib/format";
import { organizationsAdmin } from "../../data/organizations";
import type { OrganizationSummary } from "../../model/organizations";
import { cpKeys } from "../../view-models/query-keys";
import { useOrganization } from "../../view-models/use-organization";
import { InviteResult } from "../people/invite-result";
import { RelativeTime } from "@/components/patterns/relative-time";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_ERROR = "Use lowercase letters, numbers and dashes, starting and ending with a letter or number.";

/** A duplicate slug (409) is shown under the slug field; anything else is a toast. */
function slugConflict(error: Error | null): string | undefined {
  return error instanceof ApiError && error.status === 409 ? error.message : undefined;
}
function toastUnlessConflict(error: Error) {
  if (!slugConflict(error)) toast.error(error.message);
}

export function OrganizationsPage() {
  return (
    <PlatformAdminOnly>
      <Organizations />
    </PlatformAdminOnly>
  );
}

function Organizations() {
  const { organizationId, setOrganizationId } = useOrganization();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<OrganizationSummary | null>(null);
  const [suspending, setSuspending] = useState<OrganizationSummary | null>(null);
  const [filter, setFilter] = useState("");
  const client = useQueryClient();
  const organizations = useQuery({ queryKey: cpKeys.organizations, queryFn: organizationsAdmin.list });
  const visible = (organizations.data ?? []).filter((entry) => matchesQuery(filter, entry.name, entry.slug, entry.id));
  const refresh = () => {
    void client.invalidateQueries({ queryKey: cpKeys.organizations });
    void client.invalidateQueries({ queryKey: cpKeys.session });
  };
  const setStatus = useMutation({
    mutationFn: (input: { organization: OrganizationSummary; status: "active" | "suspended" }) => organizationsAdmin.setStatus(input.organization.id, input.status),
    onSuccess: (organization) => {
      toast.success(organization.status === "suspended" ? `Suspended ${organization.name}` : `Reactivated ${organization.name}`);
      setSuspending(null);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const open = (organization: OrganizationSummary) => {
    setOrganizationId(organization.id);
    router.push("/projects");
  };

  return (
    <>
      <PageHeader
        title="Organizations"
        description="Every organization on this APICenter. Suspending one stops its applications' requests; its members keep console access."
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" /> New organization
          </Button>
        }
      />
      {organizations.error ? <ErrorPanel title="Organizations could not be loaded" error={organizations.error} /> : null}
      {!organizations.error ? (
        <Panel flush>
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <SearchIcon className="size-3.5 text-muted-foreground" />
            <input
              aria-label="Filter organizations"
              placeholder="Filter by name, slug or ID"
              className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          {organizations.isLoading ? (
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<Building2Icon />}
              title={filter ? "No organization matches the filter" : "No organizations yet"}
              description={filter ? undefined : "Create an organization and name its first owner; they are emailed an invite."}
              action={
                filter ? null : (
                  <Button variant="outline" onClick={() => setCreating(true)}>
                    <PlusIcon data-icon="inline-start" /> New organization
                  </Button>
                )
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Projects</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Members</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="hidden 2xl:table-cell">ID</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((organization) => (
                  <TableRow key={organization.id}>
                    <TableCell>
                      <button type="button" className="text-left font-medium hover:underline" onClick={() => open(organization)}>
                        {organization.name}
                      </button>
                      {organization.id === organizationId ? <span className="ml-2 text-xs text-muted-foreground">current</span> : null}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{organization.slug}</TableCell>
                    <TableCell>
                      <StatusBadge status={organization.status} />
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{formatNumber(organization.projectCount)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{formatNumber(organization.memberCount)}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell"><RelativeTime value={organization.createdAt} /></TableCell>
                    <TableCell className="hidden 2xl:table-cell">
                      <IdText value={organization.id} />
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Actions for ${organization.name}`} />}>
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => open(organization)}>Open</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRenaming(organization)}>Rename</DropdownMenuItem>
                          {organization.status === "active" || organization.status === "suspended" ? <DropdownMenuSeparator /> : null}
                          {organization.status === "active" ? (
                            <DropdownMenuItem variant="destructive" onClick={() => setSuspending(organization)}>
                              Suspend
                            </DropdownMenuItem>
                          ) : null}
                          {organization.status === "suspended" ? (
                            <DropdownMenuItem onClick={() => setStatus.mutate({ organization, status: "active" })}>Reactivate</DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      ) : null}

      <CreateOrganizationSheet open={creating} onOpenChange={setCreating} onCreated={refresh} />
      <RenameOrganizationSheet organization={renaming} onClose={() => setRenaming(null)} onRenamed={refresh} />
      <ConfirmDialog
        open={suspending !== null}
        onOpenChange={(next) => !next && setSuspending(null)}
        title={`Suspend ${suspending?.name ?? ""}`}
        description="Every request from its applications is refused at once and no new projects can be created. Members can still sign in and change its settings, members and keys. You can reactivate it later."
        confirmLabel={`Suspend ${suspending?.name ?? ""}`}
        destructive
        busy={setStatus.isPending}
        onConfirm={() => suspending && setStatus.mutate({ organization: suspending, status: "suspended" })}
      />
    </>
  );
}

function CreateOrganizationSheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const { setOrganizationId } = useOrganization();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [created, setCreated] = useState<Awaited<ReturnType<typeof organizationsAdmin.create>> | null>(null);
  const owner = ownerEmail.trim().toLowerCase();
  const close = (next: boolean) => {
    if (!next) {
      setName("");
      setSlug("");
      setSlugEdited(false);
      setOwnerEmail("");
      setCreated(null);
    }
    onOpenChange(next);
  };
  const create = useMutation({
    mutationFn: () => organizationsAdmin.create({ name: name.trim(), slug, ...(owner ? { ownerEmail: owner } : {}) }),
    onSuccess: (organization) => {
      // Act in the new organization at once; the switcher lists it once the session and list refetch.
      setOrganizationId(organization.id);
      onCreated();
      // With an owner, the sheet shows how their invite went; a toast would cover its footer.
      if (organization.owner) setCreated(organization);
      else {
        toast.success(`Created ${organization.name}`);
        close(false);
      }
    },
    onError: toastUnlessConflict,
  });
  const slugValid = SLUG_PATTERN.test(slug);
  const ownerValid = !owner || EMAIL.test(owner);

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="sm:max-w-md">
        {created?.owner ? (
          <div className="flex h-full flex-col">
            <SheetHeader>
              <SheetTitle>Created {created.name}</SheetTitle>
              <SheetDescription>It is now the organization you are working in. {created.owner.email} is its owner.</SheetDescription>
            </SheetHeader>
            <div className="px-4">
              <InviteResult email={created.owner.email} invite={created.owner.invite} />
            </div>
            <SheetFooter className="mt-auto flex-row justify-end border-t">
              <Button type="button" onClick={() => close(false)}>
                Done
              </Button>
            </SheetFooter>
          </div>
        ) : (
          <form
            className="flex h-full flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <SheetHeader>
              <SheetTitle>New organization</SheetTitle>
              <SheetDescription>An organization owns projects and people. Name its first owner to send them an invite.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4">
              <FormRow label="Name" htmlFor="organization-name">
                <Input
                  id="organization-name"
                  autoFocus
                  placeholder="Acme Corporation"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (!slugEdited) {
                      setSlug(toSlug(event.target.value));
                      create.reset();
                    }
                  }}
                />
              </FormRow>
              <FormRow
                label="Slug"
                htmlFor="organization-slug"
                hint="Lowercase letters, numbers and dashes."
                error={slug && !slugValid ? SLUG_ERROR : slugConflict(create.error)}
              >
                <Input
                  id="organization-slug"
                  className="font-mono"
                  value={slug}
                  aria-invalid={Boolean(slug) && !slugValid}
                  onChange={(event) => {
                    setSlugEdited(true);
                    setSlug(event.target.value);
                    create.reset();
                  }}
                />
              </FormRow>
              <FormRow
                label="First owner (optional)"
                htmlFor="organization-owner"
                hint="Their email; they sign in with the Google account for it."
                error={!ownerValid ? "Enter a valid email address." : undefined}
              >
                <Input
                  id="organization-owner"
                  type="email"
                  placeholder="owner@company.com"
                  value={ownerEmail}
                  aria-invalid={!ownerValid}
                  onChange={(event) => setOwnerEmail(event.target.value)}
                />
              </FormRow>
            </div>
            <SheetFooter className="mt-auto flex-row justify-end border-t">
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || !slugValid || !ownerValid || create.isPending}>
                {create.isPending ? "Creating…" : "Create organization"}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RenameOrganizationSheet({ organization, onClose, onRenamed }: { organization: OrganizationSummary | null; onClose: () => void; onRenamed: () => void }) {
  return (
    <Sheet open={organization !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="sm:max-w-md">
        {organization ? <RenameForm key={organization.id} organization={organization} onClose={onClose} onRenamed={onRenamed} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function RenameForm({ organization, onClose, onRenamed }: { organization: OrganizationSummary; onClose: () => void; onRenamed: () => void }) {
  const [name, setName] = useState(organization.name);
  const [slug, setSlug] = useState(organization.slug);
  const rename = useMutation({
    mutationFn: () => organizationsAdmin.rename(organization.id, { name: name.trim(), slug }),
    onSuccess: (renamed) => {
      toast.success(`Renamed to ${renamed.name}`);
      onRenamed();
      onClose();
    },
    onError: toastUnlessConflict,
  });
  const slugValid = SLUG_PATTERN.test(slug);
  const changed = name.trim() !== organization.name || slug !== organization.slug;

  return (
    <form
      className="flex h-full flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        rename.mutate();
      }}
    >
      <SheetHeader>
        <SheetTitle>Rename {organization.name}</SheetTitle>
        <SheetDescription>Members see the new name the next time the console loads. Its ID does not change.</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4">
        <FormRow label="Name" htmlFor="rename-organization-name">
          <Input id="rename-organization-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </FormRow>
        <FormRow
          label="Slug"
          htmlFor="rename-organization-slug"
          hint="Lowercase letters, numbers and dashes."
          error={slug && !slugValid ? SLUG_ERROR : slugConflict(rename.error)}
        >
          <Input
            id="rename-organization-slug"
            className="font-mono"
            value={slug}
            aria-invalid={Boolean(slug) && !slugValid}
            onChange={(event) => {
              setSlug(event.target.value);
              rename.reset();
            }}
          />
        </FormRow>
      </div>
      <SheetFooter className="mt-auto flex-row justify-end border-t">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || !slugValid || !changed || rename.isPending}>
          {rename.isPending ? "Saving…" : "Save"}
        </Button>
      </SheetFooter>
    </form>
  );
}
