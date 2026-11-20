import type { EnvironmentKind, Me } from "./control-plane";

export type ProjectRole = "admin" | "developer" | "viewer";
export type OrganizationRole = "owner" | "admin" | "developer" | "viewer";

/** What the signed-in person may do in one organization, mirroring the gateway's console access policy. */
export type Access = {
  organizationRole: OrganizationRole | null;
  platform: boolean;
  /** The effective role on a project; organization owners and admins are admins of every project. */
  projectRole: (projectId: string) => ProjectRole | null;
  canCreateProject: boolean;
  canManageMembers: boolean;
  canManageOwners: boolean;
  canManageTeams: boolean;
  canManageQuotas: boolean;
  /** Reads the audit log: every event for owners and admins, their projects' events for project admins. */
  canReadAuditLog: boolean;
  /** Reads every event in the organization, including members and teams. */
  canReadOrganizationAudit: boolean;
  canManageProject: (projectId: string) => boolean;
  canWriteEnvironment: (projectId: string, kind: EnvironmentKind) => boolean;
};

const PROJECT_RANK: Record<ProjectRole, number> = { viewer: 1, developer: 2, admin: 3 };

export function accessFrom(me: Me | undefined): Access {
  const platform = me?.platformAccess === true;
  const organizationRole = (me?.organizationRole ?? null) as OrganizationRole | null;
  const orgAdmin = platform || organizationRole === "owner" || organizationRole === "admin";

  const projectRole = (projectId: string): ProjectRole | null => {
    if (orgAdmin) return "admin";
    const role = me?.projectRoles[projectId];
    return role === "admin" || role === "developer" || role === "viewer" ? role : null;
  };
  const atLeast = (projectId: string, role: ProjectRole) => {
    const actual = projectRole(projectId);
    return actual !== null && PROJECT_RANK[actual] >= PROJECT_RANK[role];
  };

  return {
    organizationRole,
    platform,
    projectRole,
    canCreateProject: platform || (organizationRole !== null && organizationRole !== "viewer"),
    canManageMembers: orgAdmin,
    canManageOwners: platform || organizationRole === "owner",
    canManageTeams: orgAdmin,
    canManageQuotas: orgAdmin,
    canReadAuditLog: orgAdmin || (organizationRole !== null && Object.values(me?.projectRoles ?? {}).includes("admin")),
    canReadOrganizationAudit: orgAdmin,
    canManageProject: (projectId) => atLeast(projectId, "admin"),
    canWriteEnvironment: (projectId, kind) => atLeast(projectId, kind === "live" ? "admin" : "developer"),
  };
}

/** Why an environment write is unavailable, for the disabled control's tooltip. */
export function environmentWriteReason(kind: EnvironmentKind) {
  return kind === "live" ? "Changing live needs the project admin role." : "Changing test needs the developer role or higher on this project.";
}

export const PROJECT_ADMIN_REASON = "Needs the project admin role.";
export const AUDIT_REASON = "The audit log is for organization owners and admins, and for project admins on their projects.";
export const ORGANIZATION_ADMIN_REASON = "Needs the organization owner or admin role.";
