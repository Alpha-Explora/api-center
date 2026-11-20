// A project must keep someone who can administer it. Organization owners and admins administer
// every project implicitly; anyone else needs an explicit admin assignment, directly or via a team.
// A change is refused when it would leave a project that has an administrator with neither: removing
// or demoting an explicit admin, or removing an admin from the organization or from an admin team.

import { AppError } from "@shared/errors";
import type { TenantDb } from "./tenant-transaction";

export interface ProjectAdministrators {
  /** Active organization members whose organization role is owner or admin. */
  organizationAdmins: number;
  /** The project's admin assignments. */
  adminAssignments: Array<{ memberEmail: string | null; teamId: string | null }>;
  /** Emails of active organization members. */
  activeMembers: ReadonlySet<string>;
  /** Members of each team named by an admin assignment. */
  teamMembers: ReadonlyMap<string, readonly string[]>;
}

/** True when someone who is an active member of the organization can still administer the project. */
export function hasProjectAdministrator(state: ProjectAdministrators): boolean {
  if (state.organizationAdmins > 0) return true;
  return state.adminAssignments.some((assignment) =>
    assignment.memberEmail
      ? state.activeMembers.has(assignment.memberEmail)
      : (state.teamMembers.get(assignment.teamId ?? "") ?? []).some((email) => state.activeMembers.has(email)),
  );
}

/** A change that can stop someone administering projects. */
export type AdministratorChange =
  /** A project admin assignment is removed or given a lesser role. */
  | { kind: "assignment"; assignmentId: string }
  /** A person leaves the organization. */
  | { kind: "member"; email: string }
  /** A person leaves a team. */
  | { kind: "teamMember"; teamId: string; email: string };

type Member = { email: string; role: string };
type Assignment = { id: string; projectId: string; memberEmail: string | null; teamId: string | null };
type TeamMember = { teamId: string; email: string };

const administersOrganization = (member: Member) => member.role === "owner" || member.role === "admin";

/**
 * Throws 409 LAST_PROJECT_ADMIN when `change` would leave a project that has an administrator
 * without one. Runs inside the caller's tenant transaction, before the change is written.
 */
export async function assertProjectsKeepAdministrator(db: TenantDb, organizationId: string, change: AdministratorChange): Promise<void> {
  const members: Member[] = await db.organizationMember.findMany({ where: { organizationId, status: "active" }, select: { email: true, role: true } });
  const membersAfter = change.kind === "member" ? members.filter((member) => member.email !== change.email) : members;
  if (membersAfter.some(administersOrganization)) return;

  const assignments: Assignment[] = await db.cpProjectRoleAssignment.findMany({
    where: { organizationId, role: "admin" },
    select: { id: true, projectId: true, memberEmail: true, teamId: true },
  });
  const teamMembers: TeamMember[] = await db.cpTeamMember.findMany({ where: { organizationId }, select: { teamId: true, email: true } });
  const before = administratorsOf(members, assignments, teamMembers);
  const after = administratorsOf(
    membersAfter,
    change.kind === "assignment" ? assignments.filter((assignment) => assignment.id !== change.assignmentId) : assignments,
    change.kind === "teamMember" ? teamMembers.filter((row) => !(row.teamId === change.teamId && row.email === change.email)) : teamMembers,
  );

  // Organization owners and admins administer every project, so losing the last one affects them all.
  const projectIds = members.some(administersOrganization)
    ? (await db.cpProject.findMany({ where: { organizationId }, select: { id: true } })).map((project) => project.id)
    : [...new Set(assignments.map((assignment) => assignment.projectId))];
  for (const projectId of projectIds) {
    if (hasProjectAdministrator(before(projectId)) && !hasProjectAdministrator(after(projectId))) {
      throw new AppError(
        "This is the project's last administrator, and the organization has no owner or admin to take over. Make someone else a project admin first.",
        409,
        "LAST_PROJECT_ADMIN",
      );
    }
  }
}

/** Who can administer each project, given the organization's members, admin assignments and teams. */
function administratorsOf(members: Member[], assignments: Assignment[], rows: TeamMember[]): (projectId: string) => ProjectAdministrators {
  const organizationAdmins = members.filter(administersOrganization).length;
  const activeMembers = new Set(members.map((member) => member.email));
  const teamMembers = new Map<string, string[]>();
  for (const row of rows) teamMembers.set(row.teamId, [...(teamMembers.get(row.teamId) ?? []), row.email]);
  return (projectId) => ({
    organizationAdmins,
    adminAssignments: assignments.filter((assignment) => assignment.projectId === projectId),
    activeMembers,
    teamMembers,
  });
}
