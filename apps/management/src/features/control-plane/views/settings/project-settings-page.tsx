"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, ShieldIcon } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { EmptyState } from "@/components/patterns/empty-state";
import { FormRow, NativeSelect } from "@/components/patterns/form";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { ApiError } from "@/lib/api-center/client-core";
import { projectHref } from "@/lib/app-navigation";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { controlPlane } from "../../data/control-plane-repository";
import { projectSettings, type TestRecipient } from "../../data/project-settings";
import { PROJECT_ADMIN_REASON, type ProjectRole } from "../../model/access";
import type { EnvironmentKind, ProjectEnvironment, Team } from "../../model/control-plane";
import { PROJECT_ROLES, removesLastExplicitAdmin, type ProjectRoleAssignment, type ProjectRoleInput } from "../../model/project-roles";
import { useProject } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";

export function ProjectSettingsPage() {
  const { project } = useProject();
  return (
    <>
      <PageHeader title="Project settings" description={`Who can work on ${project.name}, and whether its environments accept requests. These settings cover test and live.`} />
      <RolesPanel />
      <TestRecipientsPanel />
      <EnvironmentStatusPanel />
    </>
  );
}

// ── Test recipients ─────────────────────────────────────────────────────────

const TEST_DEVELOPER_REASON = "You need the developer role on this project to change test recipients.";

/**
 * Test keys deliver only to these recipients. A test send to anyone else succeeds and is recorded,
 * but nothing leaves APICenter; the response carries X-APICenter-Test-Delivery: suppressed.
 */
function TestRecipientsPanel() {
  const { organizationId, project, access } = useProject();
  const canWrite = access.canWriteEnvironment(project.id, "test");
  const client = useQueryClient();
  const key = cpKeys.testRecipients(organizationId, project.id);
  const [draft, setDraft] = useState("");
  const recipients = useQuery({ queryKey: key, queryFn: () => projectSettings.testRecipients(organizationId, project.id) });
  const add = useMutation({
    mutationFn: (recipient: string) => projectSettings.addTestRecipient(organizationId, project.id, recipient),
    onSuccess: (saved) => {
      toast.success(`${saved.recipient} receives test messages`);
      setDraft("");
      client.setQueryData<TestRecipient[]>(key, (current) => [...(current ?? []), saved]);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (recipient: string) => projectSettings.removeTestRecipient(organizationId, project.id, recipient),
    onSuccess: (_, recipient) => {
      toast.success(`${recipient} no longer receives test messages`);
      client.setQueryData<TestRecipient[]>(key, (current) => (current ?? []).filter((entry) => entry.recipient !== recipient));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Panel
      title="Test recipients"
      description="Test keys deliver email, SMS and OTP only to these phone numbers and addresses. A test send to anyone else succeeds and is recorded, but nothing is sent. Live is not affected."
    >
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) add.mutate(draft.trim());
        }}
      >
        <Input
          aria-label="Phone number or email address"
          placeholder="+639171234567 or dana@example.com"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!canWrite}
          className="sm:max-w-sm"
        />
        <GuardedButton type="submit" allowed={canWrite} reason={TEST_DEVELOPER_REASON} disabled={!draft.trim() || add.isPending}>
          <PlusIcon data-icon="inline-start" /> Add
        </GuardedButton>
      </form>
      <div className="mt-4">
        {recipients.error ? <ErrorPanel title="Test recipients could not be loaded" error={recipients.error} /> : null}
        {recipients.isPending ? <Skeleton className="h-16 w-full" /> : null}
        {recipients.data && recipients.data.length === 0 ? (
          <Notice title="No test recipients yet">Until you add one, test sends are recorded but not delivered to anyone.</Notice>
        ) : null}
        {recipients.data && recipients.data.length > 0 ? (
          <ul className="divide-y rounded-md border text-[13px]">
            {recipients.data.map((entry) => (
              <li key={entry.recipient} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.recipient}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">added by {entry.createdBy}</span>
                <GuardedButton
                  size="sm"
                  variant="ghost"
                  allowed={canWrite}
                  reason={TEST_DEVELOPER_REASON}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(entry.recipient)}
                >
                  Remove
                </GuardedButton>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}

// ── Project roles ───────────────────────────────────────────────────────────

function RolesPanel() {
  const { organizationId, project, canManage } = useProject();
  const client = useQueryClient();
  const rolesKey = [...cpKeys.project(organizationId, project.id), "roles"];
  const roles = useQuery({ queryKey: rolesKey, queryFn: () => projectSettings.roles(organizationId, project.id) });
  const teams = useQuery({ queryKey: cpKeys.teams(organizationId), queryFn: () => controlPlane.teams(organizationId) });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ProjectRoleAssignment | null>(null);
  const [demoting, setDemoting] = useState<{ assignment: ProjectRoleAssignment; role: ProjectRole } | null>(null);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: rolesKey });
    // The signed-in person's own project role may have changed.
    void client.invalidateQueries({ queryKey: cpKeys.me(organizationId) });
  };
  const teamsById = new Map((teams.data ?? []).map((team) => [team.id, team]));
  const rows = roles.data ?? [];
  const nameOf = (assignment: ProjectRoleAssignment) =>
    assignment.memberEmail ?? (assignment.teamId ? (teamsById.get(assignment.teamId)?.name ?? assignment.teamId) : assignment.id);

  const change = useMutation({
    mutationFn: (input: { assignment: ProjectRoleAssignment; role: ProjectRole }) => projectSettings.setRole(organizationId, project.id, assigneeOf(input.assignment, input.role)),
    onSuccess: (_, input) => {
      toast.success(`${nameOf(input.assignment)} is now ${input.role} on ${project.name}`);
      setDemoting(null);
      refresh();
    },
    // A refusal for the last admin is shown in the open dialog instead; it explains what to do.
    onError: (error: Error) => {
      if (!(demoting && isLastAdminRefusal(error))) toast.error(error.message);
    },
  });
  const remove = useMutation({
    mutationFn: (assignment: ProjectRoleAssignment) => projectSettings.removeRole(organizationId, project.id, assignment.id),
    onSuccess: (_, assignment) => {
      toast.success(`Removed ${nameOf(assignment)} from ${project.name}`);
      setRemoving(null);
      refresh();
    },
    onError: (error: Error) => {
      if (!isLastAdminRefusal(error)) toast.error(error.message);
    },
  });

  function requestChange(assignment: ProjectRoleAssignment, role: ProjectRole) {
    if (removesLastExplicitAdmin(rows, assignment, role)) setDemoting({ assignment, role });
    else change.mutate({ assignment, role });
  }

  return (
    <>
      <Panel
        title="Project roles"
        description="Admins manage roles, quotas, environment status and live. Developers change test. Viewers read both environments."
        flush
        actions={
          <GuardedButton size="sm" allowed={canManage} reason={PROJECT_ADMIN_REASON} onClick={() => setAdding(true)}>
            <PlusIcon data-icon="inline-start" /> Add role
          </GuardedButton>
        }
      >
        <Notice className="m-4 mb-0">
          Organization owners and admins are admins of every project. They are not listed here and cannot be removed from this page; change their
          organization role on{" "}
          <Link href="/people" className="text-foreground underline underline-offset-2">
            People
          </Link>
          .
        </Notice>
        {roles.error ? (
          <div className="p-4">
            <ErrorPanel title="Project roles could not be loaded" error={roles.error} />
          </div>
        ) : roles.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ShieldIcon />}
            title="No explicit project roles"
            description="Only organization owners and admins can work on this project. Give members or teams a role to let them in."
          />
        ) : (
          <Table className="mt-4 border-t">
            <TableHeader>
              <TableRow>
                <TableHead>Member or team</TableHead>
                <TableHead className="hidden w-36 sm:table-cell">Role</TableHead>
                <TableHead className="hidden md:table-cell">Added</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((assignment) => {
                const team = assignment.teamId ? teamsById.get(assignment.teamId) : undefined;
                const role = canManage ? (
                  <NativeSelect
                    aria-label={`Role of ${nameOf(assignment)}`}
                    value={assignment.role}
                    disabled={change.isPending}
                    onChange={(event) => requestChange(assignment, event.target.value as ProjectRole)}
                  >
                    {PROJECT_ROLES.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <span className="capitalize">{assignment.role}</span>
                );
                return (
                  <TableRow key={assignment.id}>
                    <TableCell className="max-w-0 min-w-40">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{nameOf(assignment)}</span>
                        {assignment.teamId ? <StatusBadge tone="info">Team</StatusBadge> : null}
                      </div>
                      {team ? <p className="truncate text-xs text-muted-foreground">{team.members.length ? team.members.join(", ") : "No members yet"}</p> : null}
                      {/* Phones have no room for a role column, so the role sits under the name. */}
                      <div className="mt-1.5 w-36 sm:hidden">{role}</div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{role}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell" title={`${formatDateTime(assignment.createdAt)} by ${assignment.createdBy}`}>
                      {formatRelative(assignment.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(assignment)}>
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

      <AddRoleSheet open={adding} onOpenChange={setAdding} assignments={rows} teams={teams.data ?? []} teamsError={teams.error} onSaved={refresh} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (next) return;
          setRemoving(null);
          remove.reset();
        }}
        title={`Remove ${removing ? nameOf(removing) : ""} from ${project.name}`}
        description={
          removing?.teamId
            ? "Members of this team lose the access this role gave them, unless they have a role of their own."
            : "They lose the access this role gave them at their next request, unless a team role still covers them."
        }
        confirmLabel="Remove role"
        destructive
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      >
        {isLastAdminRefusal(remove.error) ? (
          <LastAdminRefusal error={remove.error} />
        ) : removing && removesLastExplicitAdmin(rows, removing) ? (
          <LastAdminWarning />
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={demoting !== null}
        onOpenChange={(next) => {
          if (next) return;
          setDemoting(null);
          change.reset();
        }}
        title={`Make ${demoting ? nameOf(demoting.assignment) : ""} ${demoting?.role ?? ""}`}
        confirmLabel={`Make ${demoting?.role ?? ""}`}
        busy={change.isPending}
        onConfirm={() => demoting && change.mutate(demoting)}
      >
        {isLastAdminRefusal(change.error) ? <LastAdminRefusal error={change.error} /> : <LastAdminWarning />}
      </ConfirmDialog>
    </>
  );
}

function LastAdminWarning() {
  return (
    <Notice tone="warning" title="This is the last explicit project admin">
      Afterwards only organization owners and admins can manage this project&apos;s roles, quotas, environment status and live. If the organization has
      no active owner or admin, the gateway refuses the change.
    </Notice>
  );
}

/** The gateway keeps someone able to administer every project (409 LAST_PROJECT_ADMIN). */
function isLastAdminRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === "LAST_PROJECT_ADMIN";
}

function LastAdminRefusal({ error }: { error: ApiError }) {
  return <ErrorPanel title="The gateway kept this admin" error={error} />;
}

function assigneeOf(assignment: ProjectRoleAssignment, role: ProjectRole): ProjectRoleInput {
  return assignment.memberEmail ? { memberEmail: assignment.memberEmail, role } : { teamId: assignment.teamId as string, role };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AddRoleSheet({
  open,
  onOpenChange,
  assignments,
  teams,
  teamsError,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignments: ProjectRoleAssignment[];
  teams: Team[];
  teamsError: unknown;
  onSaved: () => void;
}) {
  const { organizationId, project } = useProject();
  const [kind, setKind] = useState<"member" | "team">("member");
  const [email, setEmail] = useState("");
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState<ProjectRole>("developer");
  const members = useQuery({ queryKey: cpKeys.members(organizationId), queryFn: () => controlPlane.members(organizationId), enabled: open });
  const normalized = email.trim().toLowerCase();
  const input: ProjectRoleInput | undefined =
    kind === "member" ? (EMAIL.test(normalized) ? { memberEmail: normalized, role } : undefined) : teamId ? { teamId, role } : undefined;
  const existing = input
    ? assignments.find((entry) => ("memberEmail" in input ? entry.memberEmail?.toLowerCase() === input.memberEmail : entry.teamId === input.teamId))
    : undefined;
  const save = useMutation({
    mutationFn: (value: ProjectRoleInput) => projectSettings.setRole(organizationId, project.id, value),
    onSuccess: () => {
      toast.success(`${kind === "member" ? normalized : (teams.find((team) => team.id === teamId)?.name ?? "The team")} is ${role} on ${project.name}`);
      close(false);
      onSaved();
    },
  });
  const notAMember = save.error instanceof ApiError && save.error.code === "NOT_A_MEMBER";

  function close(next: boolean) {
    if (!next) {
      setKind("member");
      setEmail("");
      setTeamId("");
      setRole("developer");
      save.reset();
    }
    onOpenChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="sm:max-w-md">
        <form
          className="flex h-full flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (input) save.mutate(input);
          }}
        >
          <SheetHeader>
            <SheetTitle>Add a project role</SheetTitle>
            <SheetDescription>For {project.name}, in test and live. The person must already be a member of the organization.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 overflow-y-auto px-4">
            <div role="radiogroup" aria-label="Assign to" className="grid grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5">
              {(["member", "team"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={kind === value}
                  onClick={() => {
                    setKind(value);
                    save.reset();
                  }}
                  className={cn(
                    "h-7 rounded-[5px] text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                    kind === value && "bg-card text-foreground shadow-xs dark:bg-input/40",
                  )}
                >
                  {value === "member" ? "Member" : "Team"}
                </button>
              ))}
            </div>

            {kind === "member" ? (
              <FormRow label="Member email" htmlFor="role-email" hint="An organization member. Their organization role does not change.">
                <Input
                  id="role-email"
                  type="email"
                  autoFocus
                  list="role-member-emails"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    save.reset();
                  }}
                />
                <datalist id="role-member-emails">
                  {(members.data ?? []).map((member) => (
                    <option key={member.email} value={member.email} />
                  ))}
                </datalist>
              </FormRow>
            ) : teamsError ? (
              <ErrorPanel title="Teams could not be loaded" error={teamsError} />
            ) : teams.length === 0 ? (
              <Notice title="No teams yet">
                Create a team on{" "}
                <Link href="/people" className="text-foreground underline underline-offset-2">
                  People
                </Link>{" "}
                first.
              </Notice>
            ) : (
              <FormRow label="Team" htmlFor="role-team" hint="Every member of the team gets this role, now and as members are added.">
                <NativeSelect id="role-team" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                  <option value="">Choose a team…</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name} ({team.members.length} member{team.members.length === 1 ? "" : "s"})
                    </option>
                  ))}
                </NativeSelect>
              </FormRow>
            )}

            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1.5 text-[13px] font-medium">Role</legend>
              {PROJECT_ROLES.map((entry) => (
                <label
                  key={entry.value}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-[13px] has-checked:border-foreground/40 has-checked:bg-muted/60"
                >
                  <input type="radio" name="project-role" className="mt-0.5 accent-foreground" checked={role === entry.value} onChange={() => setRole(entry.value)} />
                  <span>
                    <span className="block font-medium">{entry.label}</span>
                    <span className="block text-xs text-muted-foreground">{entry.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {existing ? (
              <Notice>
                Already {existing.role} on this project. Saving changes the role to {role}.
              </Notice>
            ) : null}
            {notAMember ? (
              <Notice
                tone="warning"
                title={`${normalized} is not a member of this organization`}
                action={
                  <Link href="/people" className={buttonVariants({ size: "sm", variant: "outline" })}>
                    Open People
                  </Link>
                }
              >
                Add them on People first, then give them a project role.
              </Notice>
            ) : save.error ? (
              <ErrorPanel title="The role could not be saved" error={save.error} />
            ) : null}
          </div>
          <SheetFooter className="mt-auto flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!input || save.isPending}>
              {save.isPending ? "Saving…" : existing ? "Change role" : "Add role"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ── Environment status ──────────────────────────────────────────────────────

const STATUS_COPY: Record<string, string> = {
  active: "Accepts requests from its applications.",
  suspended: "Refuses every request from its applications until it is resumed.",
  provisioning: "Being set up. Finish going live from the overview before changing its status.",
};

function EnvironmentStatusPanel() {
  const { organizationId, project, canManage } = useProject();
  const client = useQueryClient();
  const [pending, setPending] = useState<{ kind: EnvironmentKind; status: "active" | "suspended" } | null>(null);
  const update = useMutation({
    mutationFn: (input: { kind: EnvironmentKind; status: "active" | "suspended" }) => projectSettings.setEnvironmentStatus(organizationId, project.id, input.kind, input.status),
    onSuccess: (_, input) => {
      toast.success(`${input.status === "suspended" ? "Suspended" : "Resumed"} ${input.kind}`);
      setPending(null);
      void client.invalidateQueries({ queryKey: cpKeys.project(organizationId, project.id) });
      void client.invalidateQueries({ queryKey: cpKeys.projects(organizationId) });
    },
    onError: (error: Error) => {
      setPending(null);
      toast.error(error.message);
    },
  });
  const byKind = new Map(project.environments.map((environment) => [environment.kind, environment]));
  const suspending = pending?.status === "suspended";

  return (
    <>
      <Panel title="Environment status" description="A suspended environment refuses every application request, whether it uses an API key or a workload identity." flush>
        <ul className="divide-y">
          {(["test", "live"] as const).map((kind) => (
            <EnvironmentRow key={kind} kind={kind} environment={byKind.get(kind)} projectId={project.id} canManage={canManage} onChange={(status) => setPending({ kind, status })} />
          ))}
        </ul>
      </Panel>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => !next && setPending(null)}
        title={`${suspending ? "Suspend" : "Resume"} ${project.name} ${pending?.kind ?? ""}`}
        description={
          suspending
            ? `Every request from ${project.name}'s ${pending?.kind} applications is refused with ENVIRONMENT_INACTIVE from the next request, until you resume it. Applications, keys, grants and configuration are kept.`
            : `${project.name}'s ${pending?.kind} applications can make requests again from the next request.`
        }
        confirmLabel={suspending ? `Suspend ${pending?.kind ?? ""}` : `Resume ${pending?.kind ?? ""}`}
        destructive={suspending}
        busy={update.isPending}
        onConfirm={() => pending && update.mutate(pending)}
      />
    </>
  );
}

function EnvironmentRow({
  kind,
  environment,
  projectId,
  canManage,
  onChange,
}: {
  kind: EnvironmentKind;
  environment: ProjectEnvironment | undefined;
  projectId: string;
  canManage: boolean;
  onChange: (status: "active" | "suspended") => void;
}) {
  const label = kind === "live" ? "Live" : "Test";
  const provisioning = environment?.status === "provisioning";
  const suspended = environment?.status === "suspended";
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span aria-hidden className={cn("size-1.5 rounded-full", kind === "live" ? "bg-live" : "bg-muted-foreground/60")} />
          <span className="text-[13px] font-medium">{label}</span>
          {environment ? <StatusBadge status={environment.status} /> : <StatusBadge tone="neutral">Not set up</StatusBadge>}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {environment ? (STATUS_COPY[environment.status] ?? `Status ${environment.status}.`) : "This project has no live environment yet. Set it up from the live overview."}
        </p>
      </div>
      {!environment ? (
        <Link href={projectHref(projectId, kind)} className={buttonVariants({ size: "sm", variant: "outline" })}>
          Go to overview
        </Link>
      ) : (
        <div className="shrink-0">
          <GuardedButton
            size="sm"
            variant={suspended ? "default" : "outline"}
            allowed={canManage && !provisioning}
            reason={canManage ? "Live is still being set up; activate it from the overview first." : PROJECT_ADMIN_REASON}
            onClick={() => onChange(suspended ? "active" : "suspended")}
          >
            {suspended ? `Resume ${kind}` : `Suspend ${kind}`}
          </GuardedButton>
        </div>
      )}
    </li>
  );
}
