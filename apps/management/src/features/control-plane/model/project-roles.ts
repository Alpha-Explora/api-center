import { z } from "zod";
import type { ProjectRole } from "./access";

/** An explicit project role, for one member or one team. Organization owners and admins are never listed. */
export const projectRoleAssignmentSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  memberEmail: z.string().nullable(),
  teamId: z.string().nullable(),
  role: z.enum(["admin", "developer", "viewer"]),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type ProjectRoleAssignment = z.infer<typeof projectRoleAssignmentSchema>;

export const PROJECT_ROLES: { value: ProjectRole; label: string; description: string }[] = [
  { value: "admin", label: "Admin", description: "Manages roles, quotas, environment status and live." },
  { value: "developer", label: "Developer", description: "Changes test: applications, grants, keys, capabilities." },
  { value: "viewer", label: "Viewer", description: "Reads both environments." },
];

export type ProjectRoleInput = { memberEmail: string; role: ProjectRole } | { teamId: string; role: ProjectRole };

/**
 * Whether removing this assignment, or demoting it to `nextRole`, leaves no explicit admin. Organization
 * owners and admins still administer the project, so it is a warning rather than a lockout.
 */
export function removesLastExplicitAdmin(assignments: ProjectRoleAssignment[], target: ProjectRoleAssignment, nextRole?: ProjectRole) {
  if (target.role !== "admin" || nextRole === "admin") return false;
  return !assignments.some((entry) => entry.id !== target.id && entry.role === "admin");
}
