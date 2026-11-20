"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, UsersIcon } from "lucide-react";
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
import { toSlug } from "@/lib/format";
import { controlPlane } from "../../data/control-plane-repository";
import { members as memberRoutes } from "../../data/members";
import { ORGANIZATION_ADMIN_REASON, type Access, type OrganizationRole } from "../../model/access";
import type { Member, Team } from "../../model/control-plane";
import type { MemberChange } from "../../model/organizations";
import { cpKeys } from "../../view-models/query-keys";
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
  const members = useQuery({ queryKey: cpKeys.members(organizationId ?? "none"), queryFn: () => controlPlane.members(organizationId as string), enabled: Boolean(organizationId) });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [suspending, setSuspending] = useState<Member | null>(null);
  // When the page opened; invite countdowns are read against it.
  const [now] = useState(() => Date.now());
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
        {members.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead className="w-40">Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(members.data ?? []).map((member) => {
                const editable = canEditMember(access, member);
                const self = member.email.toLowerCase() === session?.email?.toLowerCase();
                return (
                  <TableRow key={member.email}>
                    <TableCell>
                      {member.email}
                      {self ? <span className="ml-2 text-xs text-muted-foreground">you</span> : null}
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
                    <TableCell>
                      <MemberStatus member={member} now={now} />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {editable && (member.status === "invited" || member.status === "invite_expired") ? (
                        <Button size="sm" variant="ghost" disabled={resend.isPending} onClick={() => resend.mutate(member.email)}>
                          Resend invite
                        </Button>
                      ) : null}
                      {editable && !self && member.status === "active" ? (
                        <Button size="sm" variant="ghost" onClick={() => setSuspending(member)}>
                          Suspend
                        </Button>
                      ) : null}
                      {editable && member.status === "suspended" ? (
                        <Button size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ email: member.email, status: "active" })}>
                          Restore
                        </Button>
                      ) : null}
                      {editable ? (
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(member)}>
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
      </Panel>

      <TeamsPanel organizationId={organizationId} access={access} />

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
  // A new member's invite outcome, shown in place of the form until the sheet closes.
  const [added, setAdded] = useState<MemberChange | null>(null);
  const normalized = email.trim().toLowerCase();
  const close = (next: boolean) => {
    if (!next) {
      setAdded(null);
      setEmail("");
    }
    onOpenChange(next);
  };
  const add = useMutation({
    mutationFn: () => memberRoutes.set(organizationId, normalized, role),
    onSuccess: (change) => {
      onAdded();
      if (change.invite) {
        setAdded(change);
        return;
      }
      toast.success(`${change.email} is now ${change.role}`);
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
              <Button type="button" variant="outline" onClick={() => { setAdded(null); setEmail(""); }}>
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
          <div className="flex flex-col gap-4 px-4">
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
          </div>
          <SheetFooter className="mt-auto flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || !routable || add.isPending}>
              {add.isPending ? "Adding…" : "Add member"}
            </Button>
          </SheetFooter>
        </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TeamsPanel({ organizationId, access }: { organizationId: string; access: Access }) {
  const client = useQueryClient();
  const teams = useQuery({ queryKey: cpKeys.teams(organizationId), queryFn: () => controlPlane.teams(organizationId) });
  const [name, setName] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: cpKeys.teams(organizationId) });
  const create = useMutation({
    mutationFn: () => controlPlane.createTeam(organizationId, { name: name.trim(), slug: toSlug(name) }),
    onSuccess: (team) => {
      toast.success(`Created ${team.name}`);
      setName("");
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
        access.canManageTeams ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <Input aria-label="New team name" placeholder="New team name" className="h-7 w-44" value={name} onChange={(event) => setName(event.target.value)} />
            <Button size="sm" variant="outline" type="submit" disabled={!name.trim() || create.isPending}>
              Create
            </Button>
          </form>
        ) : null
      }
    >
      {teams.error ? (
        <div className="p-4">
          <ErrorPanel title="Teams could not be loaded" error={teams.error} />
        </div>
      ) : (teams.data ?? []).length === 0 ? (
        <EmptyState icon={<UsersIcon />} title="No teams" />
      ) : (
        <ul className="divide-y">
          {(teams.data ?? []).map((team) => (
            <TeamRow key={team.id} organizationId={organizationId} team={team} canManage={access.canManageTeams} onChanged={() => void refresh()} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TeamRow({ organizationId, team, canManage, onChanged }: { organizationId: string; team: Team; canManage: boolean; onChanged: () => void }) {
  const [email, setEmail] = useState("");
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
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">
          {team.name} <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{team.slug}</span>
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{team.members.length ? team.members.join(", ") : "No members"}</p>
      </div>
      {canManage ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (ROUTABLE_EMAIL.test(normalized) && normalized.includes("@")) add.mutate();
          }}
        >
          <Input aria-label={`Add a member to ${team.name}`} placeholder="member email" className="h-7 w-52" value={email} onChange={(event) => setEmail(event.target.value)} />
          <Button size="sm" variant="ghost" type="submit" disabled={!normalized.includes("@") || add.isPending}>
            Add
          </Button>
        </form>
      ) : null}
    </li>
  );
}
