// Organization members, teams and project role assignments.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { AppError, ConflictError, NotFoundError } from "@shared/errors";
import { normalizeOrganizationRole, type OrganizationRole, type ProjectRole } from "./console-access.policy";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function prefixedId(prefix: "tm" | "pra"): string {
  let out = "";
  while (out.length < 24) {
    for (const byte of randomBytes(48)) {
      if (byte < 252) out += ALPHABET[byte % 36];
      if (out.length === 24) break;
    }
  }
  return `${prefix}_${out}`;
}

@Injectable()
export class OrganizationPeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventsService,
  ) {}

  // ── Members ──────────────────────────────────────────────────────────────

  async listMembers(organizationId: string) {
    const members = await this.prisma.organizationMember.findMany({ where: { organizationId }, orderBy: { email: "asc" } });
    return members.map((member) => ({
      email: member.email,
      role: normalizeOrganizationRole(member.role) ?? "viewer",
      status: member.status,
      identityLinked: Boolean(member.subject),
    }));
  }

  /** The current role, normalized; undefined when the email is not a member. */
  async memberRole(organizationId: string, email: string): Promise<OrganizationRole | undefined> {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organization_members_pkey: { organizationId, email } },
    });
    return member ? normalizeOrganizationRole(member.role) : undefined;
  }

  async setMember(organizationId: string, email: string, role: OrganizationRole, actor: string) {
    await this.requireOrganization(organizationId);
    const current = await this.memberRole(organizationId, email);
    if (current === "owner" && role !== "owner") await this.assertNotLastOwner(organizationId);
    await this.prisma.organizationMember.upsert({
      where: { organization_members_pkey: { organizationId, email } },
      create: { organizationId, email, role, createdBy: actor },
      update: { role },
    });
    await this.recordAudit("control_plane.member.set", actor, `${organizationId}:${email}`, { role, previousRole: current ?? null });
    return { email, role };
  }

  async removeMember(organizationId: string, email: string, actor: string) {
    const current = await this.memberRole(organizationId, email);
    if (!current) throw new NotFoundError(`'${email}' is not a member`);
    if (current === "owner") await this.assertNotLastOwner(organizationId);
    await this.prisma.organizationMember.delete({ where: { organization_members_pkey: { organizationId, email } } });
    await this.recordAudit("control_plane.member.removed", actor, `${organizationId}:${email}`, { previousRole: current });
    return { email, removed: true };
  }

  // ── Teams ────────────────────────────────────────────────────────────────

  async createTeam(organizationId: string, input: { slug: string; name: string }, actor: string) {
    await this.requireOrganization(organizationId);
    const team = await this.uniqueOrConflict(`Team slug '${input.slug}' is already used`, () =>
      this.prisma.cpTeam.create({ data: { id: prefixedId("tm"), organizationId, slug: input.slug, name: input.name, createdBy: actor } }),
    );
    await this.recordAudit("control_plane.team.created", actor, team.id, { organizationId, slug: team.slug });
    return { ...team, members: [] as string[] };
  }

  async listTeams(organizationId: string) {
    const teams = await this.prisma.cpTeam.findMany({ where: { organizationId }, orderBy: { slug: "asc" } });
    const members = await this.prisma.cpTeamMember.findMany({ where: { organizationId } });
    return teams.map((team) => ({
      ...team,
      members: members.filter((member) => member.teamId === team.id).map((member) => member.email).sort(),
    }));
  }

  async addTeamMember(organizationId: string, teamId: string, email: string, actor: string) {
    await this.requireTeam(organizationId, teamId);
    if (!(await this.memberRole(organizationId, email))) {
      throw new AppError(`'${email}' must be an organization member before joining a team`, 409, "NOT_A_MEMBER");
    }
    await this.prisma.cpTeamMember.upsert({
      where: { teamId_email: { teamId, email } },
      create: { organizationId, teamId, email, createdBy: actor },
      update: {},
    });
    await this.recordAudit("control_plane.team.member_added", actor, teamId, { email });
    return { teamId, email };
  }

  async removeTeamMember(organizationId: string, teamId: string, email: string, actor: string) {
    await this.requireTeam(organizationId, teamId);
    await this.prisma.cpTeamMember.deleteMany({ where: { organizationId, teamId, email } });
    await this.recordAudit("control_plane.team.member_removed", actor, teamId, { email });
    return { teamId, email, removed: true };
  }

  // ── Project roles ────────────────────────────────────────────────────────

  async listProjectRoles(organizationId: string, projectId: string) {
    await this.requireProject(organizationId, projectId);
    return this.prisma.cpProjectRoleAssignment.findMany({ where: { organizationId, projectId }, orderBy: { createdAt: "asc" } });
  }

  async setProjectRole(
    organizationId: string,
    projectId: string,
    assignee: { memberEmail: string } | { teamId: string },
    role: ProjectRole,
    actor: string,
  ) {
    await this.requireProject(organizationId, projectId);
    if ("memberEmail" in assignee) {
      if (!(await this.memberRole(organizationId, assignee.memberEmail))) {
        throw new AppError(`'${assignee.memberEmail}' must be an organization member first`, 409, "NOT_A_MEMBER");
      }
    } else {
      await this.requireTeam(organizationId, assignee.teamId);
    }
    const where = { organizationId, projectId, ...assignee };
    const existing = await this.prisma.cpProjectRoleAssignment.findFirst({ where });
    const assignment = existing
      ? await this.prisma.cpProjectRoleAssignment.update({ where: { id: existing.id }, data: { role } })
      : await this.prisma.cpProjectRoleAssignment.create({
          data: { id: prefixedId("pra"), ...where, role, createdBy: actor },
        });
    await this.recordAudit("control_plane.project_role.set", actor, assignment.id, { projectId, ...assignee, role });
    return assignment;
  }

  async removeProjectRole(organizationId: string, projectId: string, assignmentId: string, actor: string) {
    const removed = await this.prisma.cpProjectRoleAssignment.deleteMany({ where: { id: assignmentId, organizationId, projectId } });
    if (removed.count === 0) throw new NotFoundError(`Role assignment '${assignmentId}' was not found`);
    await this.recordAudit("control_plane.project_role.removed", actor, assignmentId, { projectId });
    return { id: assignmentId, removed: true };
  }

  /** Makes the creator of a project its administrator. */
  async grantCreatorProjectAdmin(organizationId: string, projectId: string, email: string) {
    await this.prisma.cpProjectRoleAssignment.create({
      data: { id: prefixedId("pra"), organizationId, projectId, memberEmail: email, role: "admin", createdBy: email },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async assertNotLastOwner(organizationId: string) {
    const owners = await this.prisma.organizationMember.count({ where: { organizationId, role: "owner", status: "active" } });
    if (owners <= 1) throw new AppError("An organization must keep at least one owner", 409, "LAST_OWNER");
  }

  private async requireOrganization(organizationId: string) {
    if (!(await this.prisma.organization.findUnique({ where: { id: organizationId } }))) {
      throw new NotFoundError(`Organization '${organizationId}' was not found`);
    }
  }

  private async requireTeam(organizationId: string, teamId: string) {
    if (!(await this.prisma.cpTeam.findFirst({ where: { id: teamId, organizationId } }))) {
      throw new NotFoundError(`Team '${teamId}' was not found`);
    }
  }

  private async requireProject(organizationId: string, projectId: string) {
    if (!(await this.prisma.cpProject.findFirst({ where: { id: projectId, organizationId } }))) {
      throw new NotFoundError(`Project '${projectId}' was not found`);
    }
  }

  private async uniqueOrConflict<T>(message: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictError(message);
      throw error;
    }
  }

  private async recordAudit(type: string, actor: string, resourceId: string, payload: Record<string, unknown>) {
    await this.audit.record({
      type,
      actionFamily: "registration",
      actor,
      resourceType: type.split(".")[1],
      resourceId,
      severity: "info",
      message: type.replaceAll(".", " "),
      payload,
    });
  }
}
