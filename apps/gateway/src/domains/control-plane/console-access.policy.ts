// Who may do what in the console. Pure: callers pass the actor and the roles already loaded.
// Console roles govern human actions only; they never authorize application API requests.

import type { EnvironmentKind } from "./control-plane.types";

export type OrganizationRole = "owner" | "admin" | "developer" | "viewer";
export type ProjectRole = "admin" | "developer" | "viewer";

export type ConsoleActor =
  | { kind: "platform"; id: string }
  | { kind: "member"; email: string; subject: string; platformAdmin: boolean };

export interface MemberAccess {
  organizationRole: OrganizationRole | undefined;
  /** Effective role per project: the strongest of direct and team assignments. */
  projectRoles: Map<string, ProjectRole>;
}

export type ConsoleAction =
  | "organization.read"
  | "organization.members.manage"
  | "organization.owners.manage"
  | "organization.teams.manage"
  | "organization.quotas.manage"
  | "project.create"
  | "project.read"
  | "project.manage"
  | "environment.read"
  | "environment.write";

const PROJECT_RANK: Record<ProjectRole, number> = { viewer: 1, developer: 2, admin: 3 };

/** Stored legacy roles keep their meaning: operator = developer, observer = viewer. */
export function normalizeOrganizationRole(stored: string): OrganizationRole | undefined {
  switch (stored) {
    case "owner":
    case "admin":
    case "developer":
    case "viewer":
      return stored;
    case "operator":
      return "developer";
    case "observer":
      return "viewer";
    default:
      return undefined;
  }
}

export function strongerProjectRole(left: ProjectRole | undefined, right: ProjectRole): ProjectRole {
  return !left || PROJECT_RANK[right] > PROJECT_RANK[left] ? right : left;
}

export function hasPlatformAccess(actor: ConsoleActor): boolean {
  return actor.kind === "platform" || actor.platformAdmin;
}

/** The project role an actor effectively holds. Organization owners and admins administer every project. */
export function effectiveProjectRole(access: MemberAccess, projectId: string): ProjectRole | undefined {
  if (access.organizationRole === "owner" || access.organizationRole === "admin") return "admin";
  if (!access.organizationRole) return undefined;
  return access.projectRoles.get(projectId);
}

export function canPerform(
  actor: ConsoleActor,
  access: MemberAccess,
  action: ConsoleAction,
  target: { projectId?: string; environmentKind?: EnvironmentKind } = {},
): boolean {
  if (hasPlatformAccess(actor)) return true;
  const role = access.organizationRole;
  if (!role) return false;

  switch (action) {
    case "organization.read":
      return true;
    case "organization.owners.manage":
      return role === "owner";
    case "organization.members.manage":
    case "organization.teams.manage":
    case "organization.quotas.manage":
      return role === "owner" || role === "admin";
    case "project.create":
      return role !== "viewer";
    default:
      break;
  }

  if (!target.projectId) return false;
  const projectRole = effectiveProjectRole(access, target.projectId);
  if (!projectRole) return false;

  switch (action) {
    case "project.read":
    case "environment.read":
      return true;
    case "project.manage":
      return projectRole === "admin";
    case "environment.write":
      // Developers configure test; live changes need a project admin.
      return target.environmentKind === "test" ? PROJECT_RANK[projectRole] >= PROJECT_RANK.developer : projectRole === "admin";
    default:
      return false;
  }
}
