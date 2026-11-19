// A project must keep someone who can administer it. Organization owners and admins administer
// every project implicitly; anyone else needs an explicit admin assignment, directly or via a team.
// Removing or demoting an explicit admin is refused when it would leave the project with neither.

import { AppError } from "@shared/errors";
import type { TenantDb } from "./tenant-transaction";

export interface ProjectAdministrators {
  /** Active organization members whose organization role is owner or admin. */
  organizationAdmins: number;
  /** The project's admin assignments that remain after the change. */
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

/**
 * Throws 409 LAST_PROJECT_ADMIN when the project would have no administrator once the assignment
 * `changingAssignmentId` stops granting admin. Runs inside the caller's tenant transaction.
 */
export async function assertProjectKeepsAdministrator(
  db: TenantDb,
  organizationId: string,
  projectId: string,
  changingAssignmentId: string,
): Promise<void> {
  const organizationAdmins = await db.organizationMember.count({
    where: { organizationId, status: "active", role: { in: ["owner", "admin"] } },
  });
  if (organizationAdmins > 0) return;
  const adminAssignments = (
    await db.cpProjectRoleAssignment.findMany({
      where: { organizationId, projectId, role: "admin" },
      select: { id: true, memberEmail: true, teamId: true },
    })
  ).filter((assignment) => assignment.id !== changingAssignmentId);
  const teamIds = adminAssignments.flatMap((assignment) => (assignment.teamId ? [assignment.teamId] : []));
  const teamRows = teamIds.length
    ? await db.cpTeamMember.findMany({ where: { organizationId, teamId: { in: teamIds } }, select: { teamId: true, email: true } })
    : [];
  const members = await db.organizationMember.findMany({ where: { organizationId, status: "active" }, select: { email: true } });
  const teamMembers = new Map<string, string[]>();
  for (const row of teamRows) teamMembers.set(row.teamId, [...(teamMembers.get(row.teamId) ?? []), row.email]);

  if (!hasProjectAdministrator({ organizationAdmins, adminAssignments, activeMembers: new Set(members.map((member) => member.email)), teamMembers })) {
    throw new AppError(
      "This is the project's last administrator, and the organization has no owner or admin to take over. Make someone else a project admin first.",
      409,
      "LAST_PROJECT_ADMIN",
    );
  }
}
