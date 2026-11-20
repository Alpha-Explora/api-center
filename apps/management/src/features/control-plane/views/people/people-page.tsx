"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, UsersIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { EmptyState } from "@/components/patterns/empty-state";
import { FormRow, NativeSelect } from "@/components/patterns/form";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ErrorPanel } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { ActorLabel } from "@/components/patterns/actor-label";
import { RelativeTime } from "@/components/patterns/relative-time";
import { toSlug } from "@/lib/format";
import { controlPlane } from "../../data/control-plane-repository";
import { lifecycle } from "../../data/lifecycle";
import { members as memberRoutes } from "../../data/members";
import { ORGANIZATION_ADMIN_REASON, type Access, type OrganizationRole, type ProjectRole } from "../../model/access";
import type { Member, Team } from "../../model/control-plane";
import type { MemberChange } from "../../model/organizations";
import { cpKeys } from "../../view-models/query-keys";
import { LoadMore, usePagedList } from "../../view-models/paged-list";
import { useAccess, useOrganization } from "../../view-models/use-organization";
import { InviteResult } from "./invite-result";

const ROLES: { value: OrganizationRole; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Everything, including managing other owners." },
  { value: "admin", label: "Admin", description: "Manages members, teams, quotas and every project." },
  { value: "developer", label: "Developer", description: "Creates projects and works in projects they are assigned." },
  { value: "viewer", label: "Viewer", description: "Reads what they are assigned." },
];

/** Emails the console proxy can route; the gateway path segment allows only these characters. */
const ROUTABLE_EMAIL = /^[A-Za-z0-9_.@-]{1,320}$/;

export function PeoplePage() {
  const { organizationId, session } = useOrganization();
  const { access } = useAccess(organizationId);
  const client = useQueryClient();
  const members = usePagedList(cpKeys.members(organizationId ?? "none"), (cursor) => controlPlane.membersPage(organizationId as string, cursor), {
    enabled: Boolean(organizationId),
  });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [suspending, setSuspending] = useState<Member | null>(null);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: cpKeys.members(organizationId ?? "none") });
    void client.invalidateQueries({ queryKey: cpKeys.teams(organizationId ?? "none") });
  };
  const setRole = useMutation({
    mutationFn: (input: { email: string; role: string }) => controlPlane.setMember(organizationId as string, input.email, input.role),
    onSuccess: (_, input) => {
      toast.success(`${input.email} is now ${input.role}`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const resend = useMutation({
    mutationFn: (email: string) => memberRoutes.resendInvite(organizationId as string, email),
    onSuccess: (change) => {
      toast.success(change.invite?.status === "sent" ? `Invite sent again to ${change.email}` : `Invite renewed for ${change.email}; the email was not sent`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const setStatus = useMutation({
    mutationFn: (input: { email: string; status: "active" | "suspended" }) => memberRoutes.setStatus(organizationId as string, input.email, input.status),
    onSuccess: (_, input) => {
      toast.success(input.status === "suspended" ? `Suspended ${input.email}` : `Restored ${input.email}`);
      setSuspending(null);
      refresh();
    },
    onError: (error: Error) => {
      setSuspending(null);
      toast.error(error.message);
    },
  });
  const remove = useMutation({
    mutationFn: (email: string) => controlPlane.removeMember(organizationId as string, email),
    onSuccess: (_, email) => {
      toast.success(`Removed ${email}`);
      setRemoving(null);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!organizationId) return <EmptyState title="No organization selected" description="Choose an organization from the switcher in the sidebar." />;

  return (
    <>
      <PageHeader
        title="People"
        description="Organization roles decide who manages members and projects. Project roles are assigned per project."
        actions={
          <GuardedButton allowed={access.canManageMembers} reason={ORGANIZATION_ADMIN_REASON} onClick={() => setAdding(true)}>
            <PlusIcon data-icon="inline-start" /> Add member
          </GuardedButton>
        }
      />
      {members.error ? <ErrorPanel title="Members could not be loaded" error={members.error} /> : null}
      <Panel title="Members" description="A member's Google identity is linked on first sign-in; a different identity for the same email is refused." flush>
        {members.isPending && organizationId ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="w-40">Role</TableHead>
                <TableHead className="hidden lg:table-cell">Projects</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(members.items ?? []).map((member) => {
                const editable = canEditMember(access, member);
                const self = member.email.toLowerCase() === session?.email?.toLowerCase();
                return (
                  <TableRow key={member.email}>
                    <TableCell className="max-w-72">
                      <div className="truncate font-medium">
                        {member.email}
                        {self ? <span className="ml-2 text-xs font-normal text-muted-foreground">you</span> : null}
                      </div>
                      {member.addedAt ? (
                        <div className="flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground">
                          Added <RelativeTime value={member.addedAt} />
                          {member.addedBy ? (
                            <>
                              {" "}by <ActorLabel actor={member.addedBy} className="min-w-0" />
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {editable ? (
                        <NativeSelect
                          aria-label={`Role of ${member.email}`}
                          value={member.role}
                          disabled={setRole.isPending}
                          onChange={(event) => setRole.mutate({ email: member.email, role: event.target.value })}
                        >
                          {ROLES.filter((role) => role.value !== "owner" || access.canManageOwners).map((role) => (
                            <option key={role.value} value={role.value}>
                              {role.label}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : (
                        <span className="capitalize">{member.role}</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <MemberProjects member={member} />
                    </TableCell>
                    <TableCell>
                      <MemberStatus member={member} now={members.loadedAt} />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {editable && (member.status === "invited" || member.status === "invite_expired") ? (
                        <Button size="sm" variant="ghost" disabled={resend.isPending} onClick={() => resend.mutate(member.email)}>
                          Resend invite
                        </Button>
                      ) : null}
                      {editable && !self && member.status === "active" ? (
                        <Button size="sm" variant="quiet-destructive" onClick={() => setSuspending(member)}>
                          Suspend
                        </Button>
                      ) : null}
                      {editable && member.status === "suspended" ? (
                        <Button size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ email: member.email, status: "active" })}>
                          Restore
                        </Button>
                      ) : null}
                      {editable ? (
                        <Button size="sm" variant="quiet-destructive" onClick={() => setRemoving(member)}>
                          Remove
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <LoadMore list={members} />
      </Panel>

      <TeamsPanel organizationId={organizationId} access={access} memberEmails={(members.items ?? []).map((member) => member.email)} />

      <AddMemberSheet organizationId={organizationId} access={access} open={adding} onOpenChange={setAdding} onAdded={refresh} />
      <ConfirmDialog
        open={suspending !== null}
        onOpenChange={(next) => !next && setSuspending(null)}
        title={`Suspend ${suspending?.email ?? ""}`}
        description="They cannot sign in or act in this organization until you restore them. Their role, teams and project roles are kept."
        confirmLabel="Suspend member"
        destructive
        busy={setStatus.isPending}
        onConfirm={() => suspending && setStatus.mutate({ email: suspending.email, status: "suspended" })}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={`Remove ${removing?.email ?? ""}`}
        description="They lose access to this organization and its projects at their next request."
        confirmLabel="Remove member"
        destructive
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.email)}
      />
    </>
  );
}

const PROJECT_ROLE_LABEL: Record<string, string> = { admin: "Admin", developer: "Developer", viewer: "Viewer" };

/** What a member can work on: every project for owners and admins, otherwise their own project roles. */
export function MemberProjects({ member }: { member: Member }) {
  if (member.role === "owner" || member.role === "admin") return <span className="text-xs text-muted-foreground">Every project · Admin</span>;
  const projects = member.projects ?? [];
  if (projects.length === 0) return <span className="text-xs text-muted-foreground">No project roles</span>;
  return (
    <div className="flex max-w-80 flex-wrap gap-1">
      {projects.map((project) => (
        <span key={project.projectId} className="inline-flex h-5 items-center rounded-sm bg-muted px-1.5 text-xs">
          {project.name}
          <span className="ml-1 text-muted-foreground">· {PROJECT_ROLE_LABEL[project.role] ?? project.role}</span>
        </span>
      ))}
    </div>
  );
}

/** Where a member stands: invited (with the days left), invite expired, suspended, or signed in. */
export function MemberStatus({ member, now }: { member: Member; now: number }) {
  if (member.status === "invited") {
    const days = member.inviteExpiresAt ? Math.max(1, Math.ceil((Date.parse(member.inviteExpiresAt) - now) / 86_400_000)) : undefined;
    return <StatusBadge tone="warning">{days ? `Invited · ${days} day${days === 1 ? "" : "s"} left` : "Invited"}</StatusBadge>;
  }
  if (member.status === "invite_expired") return <StatusBadge tone="danger">Invite expired</StatusBadge>;
  if (member.status === "suspended") return <StatusBadge tone="warning">Suspended</StatusBadge>;
  return <StatusBadge tone={member.identityLinked ? "success" : "warning"}>{member.identityLinked ? "Signed in" : "Not signed in yet"}</StatusBadge>;
}

function canEditMember(access: Access, member: Member) {
  if (!access.canManageMembers) return false;
  if (member.role === "owner" && !access.canManageOwners) return false;
  return ROUTABLE_EMAIL.test(member.email);
}

function AddMemberSheet({
  organizationId,
  access,
  open,
  onOpenChange,
  onAdded,
}: {
  organizationId: string;
  access: Access;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole>("developer");
  // Project roles to give with the membership: project ID -> role.
  const [projectRoles, setProjectRoles] = useState<Record<string, ProjectRole>>({});
  // A new member's invite outcome, shown in place of the form until the sheet closes.
  const [added, setAdded] = useState<MemberChange | null>(null);
  const normalized = email.trim().toLowerCase();
  const reset = () => {
    setAdded(null);
    setEmail("");
    setProjectRoles({});
  };
  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };
  // Owners and admins already administer every project.
  const everyProject = role === "owner" || role === "admin";
  const projects = useQuery({
    queryKey: cpKeys.projects(organizationId),
    queryFn: () => controlPlane.listProjects(organizationId),
    enabled: open && !everyProject,
  });
  const chosenProjects = everyProject
    ? []
    : Object.entries(projectRoles).map(([projectId, projectRole]) => ({ projectId, role: projectRole }));
  const add = useMutation({
    mutationFn: () => memberRoutes.set(organizationId, normalized, role, chosenProjects),
    onSuccess: (change) => {
      onAdded();
      if (change.invite) {
        setAdded(change);
        return;
      }
      toast.success(`${change.email} is now ${change.role === "admin" || change.role === "owner" ? "an" : "a"} ${change.role}`);
      close(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  const routable = ROUTABLE_EMAIL.test(normalized);

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="sm:max-w-md">
        {added?.invite ? (
          <div className="flex h-full flex-col">
            <SheetHeader>
              <SheetTitle>Added {added.email}</SheetTitle>
              <SheetDescription>
                They are {added.role === "admin" || added.role === "owner" ? "an" : "a"} {added.role} now and can sign in with the Google account for this email.
              </SheetDescription>
            </SheetHeader>
            <div className="px-4">
              <InviteResult email={added.email} invite={added.invite} />
            </div>
            <SheetFooter className="mt-auto flex-row justify-end border-t">
              <Button type="button" variant="outline" onClick={reset}>
                Add another
              </Button>
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
            add.mutate();
          }}
        >
          <SheetHeader>
            <SheetTitle>Add member</SheetTitle>
            <SheetDescription>They are emailed an invite and sign in with the Google account for this email within 7 days. Adding an existing member changes their role.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
            <FormRow
              label="Email"
              htmlFor="member-email"
              error={normalized && valid && !routable ? "Emails with characters such as + are not supported yet." : undefined}
            >
              <Input id="member-email" type="email" autoFocus placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} />
            </FormRow>
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1.5 text-[13px] font-medium">Role</legend>
              {ROLES.filter((entry) => entry.value !== "owner" || access.canManageOwners).map((entry) => (
                <label key={entry.value} className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-[13px] has-checked:border-foreground/40 has-checked:bg-muted/60">
                  <input type="radio" name="role" className="mt-0.5 accent-foreground" checked={role === entry.value} onChange={() => setRole(entry.value)} />
                  <span>
                    <span className="block font-medium">{entry.label}</span>
                    <span className="block text-xs text-muted-foreground">{entry.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-[13px] font-medium">Project access</legend>
              {everyProject ? (
                <p className="text-xs text-muted-foreground">
                  {role === "owner" ? "Owners" : "Admins"} administer every project, so no project roles are needed.
                </p>
              ) : projects.isPending ? (
                <Skeleton className="h-16 w-full" />
              ) : (projects.data ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">This organization has no projects yet.</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">Optional. The invite email lists what they get; you can change it later in each project&apos;s settings.</p>
                  <ul className="divide-y rounded-md border">
                    {(projects.data ?? []).map((project) => (
                      <li key={project.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                        <span className="min-w-0 truncate text-[13px]">{project.name}</span>
                        <NativeSelect
                          aria-label={`Role on ${project.name}`}
                          className="w-32"
                          value={projectRoles[project.id] ?? ""}
                          onChange={(event) =>
                            setProjectRoles((current) => {
                              const next = { ...current };
                              if (event.target.value) next[project.id] = event.target.value as ProjectRole;
                              else delete next[project.id];
                              return next;
                            })
                          }
                        >
                          <option value="">No access</option>
                          <option value="viewer">Viewer</option>
                          <option value="developer">Developer</option>
                          <option value="admin">Admin</option>
                        </NativeSelect>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </fieldset>
          </div>
          <SheetFooter className="mt-auto flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || !routable || add.isPending}>
              {add.isPending ? "Adding…" : chosenProjects.length ? `Add with ${chosenProjects.length} project${chosenProjects.length === 1 ? "" : "s"}` : "Add member"}
            </Button>
          </SheetFooter>
        </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TeamsPanel({ organizationId, access, memberEmails }: { organizationId: string; access: Access; memberEmails: string[] }) {
  const client = useQueryClient();
  const teams = useQuery({ queryKey: cpKeys.teams(organizationId), queryFn: () => controlPlane.teams(organizationId) });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: cpKeys.teams(organizationId) });
  const create = useMutation({
    mutationFn: () => controlPlane.createTeam(organizationId, { name: name.trim(), slug: toSlug(name) }),
    onSuccess: (team) => {
      toast.success(`Created ${team.name}`);
      setName("");
      setCreating(false);
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Panel
      title="Teams"
      description="Optional groups of members. Give a team a role on a project instead of assigning each person."
      flush
      actions={
        <GuardedButton size="sm" variant="outline" allowed={access.canManageTeams} reason={ORGANIZATION_ADMIN_REASON} onClick={() => setCreating(true)}>
          <PlusIcon data-icon="inline-start" /> New team
        </GuardedButton>
      }
    >
      {creating ? (
        <form
          className="flex flex-col gap-2 border-b bg-muted/30 px-4 py-3 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input aria-label="Team name" autoFocus placeholder="Team name, e.g. Payments squad" className="sm:max-w-xs" value={name} onChange={(event) => setName(event.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? "Creating…" : "Create team"}
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => { setCreating(false); setName(""); }}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {teams.error ? (
        <div className="p-4">
          <ErrorPanel title="Teams could not be loaded" error={teams.error} />
        </div>
      ) : teams.isPending ? (
        <div className="p-3">
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (teams.data ?? []).length === 0 ? (
        creating ? null : (
          <EmptyState
            icon={<UsersIcon />}
            title="No teams yet"
            description="Teams are useful when several people share the same project roles, such as everyone working on one product."
          />
        )
      ) : (
        <ul className="divide-y">
          {(teams.data ?? []).map((team) => (
            <TeamRow
              key={team.id}
              organizationId={organizationId}
              team={team}
              canManage={access.canManageTeams}
              memberEmails={memberEmails}
              onChanged={() => void refresh()}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TeamRow({
  organizationId,
  team,
  canManage,
  memberEmails,
  onChanged,
}: {
  organizationId: string;
  team: Team;
  canManage: boolean;
  memberEmails: string[];
  onChanged: () => void;
}) {
  const [email, setEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const remove = useMutation({
    mutationFn: () => lifecycle.deleteTeam(organizationId, team.id),
    onSuccess: () => {
      toast.success(`Deleted ${team.name}`);
      setDeleting(false);
      onChanged();
    },
    onError: (error: Error) => {
      setDeleting(false);
      toast.error(error.message);
    },
  });
  const normalized = email.trim().toLowerCase();
  const add = useMutation({
    mutationFn: () => controlPlane.addTeamMember(organizationId, team.id, normalized),
    onSuccess: () => {
      toast.success(`Added ${normalized} to ${team.name}`);
      setEmail("");
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const leave = useMutation({
    mutationFn: (member: string) => controlPlane.removeTeamMember(organizationId, team.id, member),
    onSuccess: (_, member) => {
      toast.success(`Removed ${member} from ${team.name}`);
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const suggestions = memberEmails.filter((candidate) => !team.members.includes(candidate));
  const listId = `team-${team.id}-members`;
  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium" title={team.slug}>
            {team.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {team.members.length === 0 ? "No members" : `${team.members.length} member${team.members.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {canManage ? (
          <Button size="sm" variant="quiet-destructive" type="button" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        ) : null}
      </div>
      {team.members.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Members of ${team.name}`}>
          {team.members.map((member) => (
            <li key={member} className="inline-flex h-6 items-center gap-1 rounded-sm bg-muted pr-0.5 pl-2 text-xs">
              {member}
              {canManage ? (
                <button
                  type="button"
                  aria-label={`Remove ${member} from ${team.name}`}
                  disabled={leave.isPending}
                  onClick={() => leave.mutate(member)}
                  className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                >
                  <XIcon className="size-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canManage ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (ROUTABLE_EMAIL.test(normalized) && normalized.includes("@")) add.mutate();
          }}
        >
          <Input
            aria-label={`Add a member to ${team.name}`}
            placeholder="Add a member by email"
            list={listId}
            className="h-7 max-w-xs"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <datalist id={listId}>
            {suggestions.map((candidate) => (
              <option key={candidate} value={candidate} />
            ))}
          </datalist>
          <Button size="sm" variant="outline" type="submit" disabled={!normalized.includes("@") || add.isPending}>
            Add
          </Button>
        </form>
      ) : null}
      <ConfirmDialog
        open={deleting}
        onOpenChange={(next) => !next && setDeleting(false)}
        title={`Delete ${team.name}`}
        description="Its members lose the project roles they had through this team. Their organization membership is kept. A team that is a project's only administrator cannot be deleted."
        confirmLabel="Delete team"
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}
