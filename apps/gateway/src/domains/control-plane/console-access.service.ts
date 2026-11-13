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

const NO_ACCESS: MemberAccess = { organizationRole: undefined, projectRoles: new Map() };

@Injectable()
export class ConsoleAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async accessFor(actor: ConsoleActor, organizationId: string): Promise<MemberAccess> {
    if (actor.kind !== "member") return NO_ACCESS;
    const membership = await this.prisma.organizationMember.findUnique({
      where: { organization_members_pkey: { organizationId, email: actor.email } },
    });
    if (!membership || membership.status !== "active") return NO_ACCESS;

    // Link the verified identity on first sign-in; afterwards it must match.
    if (!membership.subject) {
      await this.prisma.organizationMember.update({
        where: { organization_members_pkey: { organizationId, email: actor.email } },
        data: { subject: actor.subject },
      });
    } else if (membership.subject !== actor.subject) {
      return NO_ACCESS;
    }

    const organizationRole = normalizeOrganizationRole(membership.role);
    const teamIds = (
      await this.prisma.cpTeamMember.findMany({ where: { organizationId, email: actor.email }, select: { teamId: true } })
    ).map((row) => row.teamId);
    const assignments = await this.prisma.cpProjectRoleAssignment.findMany({
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
   * gets 404, so organization and project IDs cannot be probed.
   */
  async require(
    actor: ConsoleActor,
    organizationId: string,
    action: ConsoleAction,
    target: { projectId?: string; environmentKind?: EnvironmentKind } = {},
  ): Promise<MemberAccess> {
    const access = await this.accessFor(actor, organizationId);
    if (canPerform(actor, access, action, target)) return access;
    if (!hasPlatformAccess(actor) && !access.organizationRole) {
      throw new NotFoundError(`Organization '${organizationId}' was not found`);
    }
    if (target.projectId && !canPerform(actor, access, "project.read", target)) {
      throw new NotFoundError(`Project '${target.projectId}' was not found`);
    }
    throw new ForbiddenError(`Your role does not allow ${action.replace(".", " ")}`);
  }
}
