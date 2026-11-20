// Loads a console actor's roles and enforces console-access.policy for one organization.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { ForbiddenError, NotFoundError } from "@shared/errors";
import {
  canPerform,
  hasPlatformAccess,
  normalizeOrganizationRole,
  strongerProjectRole,
  type ConsoleAction,
  type ConsoleActor,
  type MemberAccess,
  type ProjectRole,
} from "./console-access.policy";
import type { EnvironmentKind } from "./control-plane.types";
import { withTenant, type TenantDb } from "./tenant-transaction";

const NO_ACCESS: MemberAccess = { organizationRole: undefined, projectRoles: new Map() };

@Injectable()
export class ConsoleAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async accessFor(actor: ConsoleActor, organizationId: string): Promise<MemberAccess> {
    if (actor.kind !== "member") return NO_ACCESS;
    return withTenant(this.prisma, { organizationId }, (db) => this.load(db, actor, organizationId));
  }

  private async load(db: TenantDb, actor: Extract<ConsoleActor, { kind: "member" }>, organizationId: string): Promise<MemberAccess> {
    const membership = await db.organizationMember.findUnique({
      where: { organization_members_pkey: { organizationId, email: actor.email } },
    });
    if (!membership || membership.status !== "active") return NO_ACCESS;

    // Link the verified identity on first sign-in; afterwards it must match.
    if (!membership.subject) {
      await db.organizationMember.update({
        where: { organization_members_pkey: { organizationId, email: actor.email } },
        data: { subject: actor.subject },
      });
    } else if (membership.subject !== actor.subject) {
      return NO_ACCESS;
    }

    const organizationRole = normalizeOrganizationRole(membership.role);
    const teamIds = (
      await db.cpTeamMember.findMany({ where: { organizationId, email: actor.email }, select: { teamId: true } })
    ).map((row) => row.teamId);
    const assignments = await db.cpProjectRoleAssignment.findMany({
      where: {
        organizationId,
        OR: [{ memberEmail: actor.email }, ...(teamIds.length ? [{ teamId: { in: teamIds } }] : [])],
      },
      select: { projectId: true, role: true },
    });
    const projectRoles = new Map<string, ProjectRole>();
    for (const assignment of assignments) {
      projectRoles.set(assignment.projectId, strongerProjectRole(projectRoles.get(assignment.projectId), assignment.role as ProjectRole));
    }
    return { organizationRole, projectRoles };
  }

  /**
   * Throws unless the actor may perform the action. A member with no access to the organization
   * gets 404, so organization and project IDs cannot be probed. A target project must belong to the
   * organization, for every caller including the platform: the role policy treats an organization
   * owner or admin as admin of any project ID it is given, and tables without row-level security
   * rely on this check.
   */
  async require(
    actor: ConsoleActor,
    organizationId: string,
    action: ConsoleAction,
    target: { projectId?: string; environmentKind?: EnvironmentKind } = {},
  ): Promise<MemberAccess> {
    const { access, projectInOrganization } = await this.loadForTarget(actor, organizationId, target.projectId);
    if (!hasPlatformAccess(actor) && !access.organizationRole) {
      throw new NotFoundError(`Organization '${organizationId}' was not found`);
    }
    if (!projectInOrganization || (target.projectId && !canPerform(actor, access, "project.read", target))) {
      throw new NotFoundError(`Project '${target.projectId}' was not found`);
    }
    if (canPerform(actor, access, action, target)) return access;
    throw new ForbiddenError(`Your role does not allow ${action.replace(".", " ")}`);
  }

  /** The actor's roles and, when a project is named, whether it is this organization's: one transaction. */
  private async loadForTarget(actor: ConsoleActor, organizationId: string, projectId: string | undefined) {
    if (actor.kind !== "member" && !projectId) return { access: NO_ACCESS, projectInOrganization: true };
    return withTenant(this.prisma, { organizationId }, async (db) => ({
      access: actor.kind === "member" ? await this.load(db, actor, organizationId) : NO_ACCESS,
      projectInOrganization: projectId
        ? Boolean(await db.cpProject.findFirst({ where: { id: projectId, organizationId }, select: { id: true } }))
        : true,
    }));
  }
}
