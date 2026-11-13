// Organization members, teams and project role assignments.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { AppError, ConflictError, NotFoundError } from "@shared/errors";
import { normalizeOrganizationRole, type OrganizationRole, type ProjectRole } from "./console-access.policy";
import { withTenant, type TenantDb } from "./tenant-transaction";

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
    return this.tenant(organizationId, async (db) => {
      const members = await db.organizationMember.findMany({ where: { organizationId }, orderBy: { email: "asc" } });
      return members.map((member) => ({
        email: member.email,
        role: normalizeOrganizationRole(member.role) ?? "viewer",
        status: member.status,
        identityLinked: Boolean(member.subject),
      }));
    });
  }

  /** The current role, normalized; undefined when the email is not a member. */
  async memberRole(organizationId: string, email: string): Promise<OrganizationRole | undefined> {
    return this.tenant(organizationId, (db) => roleOf(db, organizationId, email));
  }

  async setMember(organizationId: string, email: string, role: OrganizationRole, actor: string) {
    const previous = await this.tenant(organizationId, async (db) => {
      await requireOrganization(db, organizationId);
      const current = await roleOf(db, organizationId, email);
      if (current === "owner" && role !== "owner") await assertNotLastOwner(db, organizationId);
      await db.organizationMember.upsert({
        where: { organization_members_pkey: { organizationId, email } },
        create: { organizationId, email, role, createdBy: actor },
        update: { role },
      });
      return current;
    });
    await this.recordAudit("control_plane.member.set", actor, `${organizationId}:${email}`, { role, previousRole: previous ?? null });
    return { email, role };
  }

  async removeMember(organizationId: string, email: string, actor: string) {
    const previous = await this.tenant(organizationId, async (db) => {
      const current = await roleOf(db, organizationId, email);
      if (!current) throw new NotFoundError(`'${email}' is not a member`);
      if (current === "owner") await assertNotLastOwner(db, organizationId);
      await db.organizationMember.delete({ where: { organization_members_pkey: { organizationId, email } } });
      return current;
    });
    await this.recordAudit("control_plane.member.removed", actor, `${organizationId}:${email}`, { previousRole: previous });
    return { email, removed: true };
  }

  // ── Teams ────────────────────────────────────────────────────────────────

  async createTeam(organizationId: string, input: { slug: string; name: string }, actor: string) {
    const team = await this.uniqueOrConflict(`Team slug '${input.slug}' is already used`, () =>
      this.tenant(organizationId, async (db) => {
        await requireOrganization(db, organizationId);
        return db.cpTeam.create({ data: { id: prefixedId("tm"), organizationId, slug: input.slug, name: input.name, createdBy: actor } });
      }),
    );
    await this.recordAudit("control_plane.team.created", actor, team.id, { organizationId, slug: team.slug });
    return { ...team, members: [] as string[] };
  }

  async listTeams(organizationId: string) {
    return this.tenant(organizationId, async (db) => {
      const teams = await db.cpTeam.findMany({ where: { organizationId }, orderBy: { slug: "asc" } });
      const members = await db.cpTeamMember.findMany({ where: { organizationId } });
      return teams.map((team) => ({
        ...team,
        members: members.filter((member) => member.teamId === team.id).map((member) => member.email).sort(),
      }));
    });
  }

  async addTeamMember(organizationId: string, teamId: string, email: string, actor: string) {
    await this.tenant(organizationId, async (db) => {
      await requireTeam(db, organizationId, teamId);
      if (!(await roleOf(db, organizationId, email))) {
        throw new AppError(`'${email}' must be an organization member before joining a team`, 409, "NOT_A_MEMBER");
      }
      await db.cpTeamMember.upsert({
        where: { teamId_email: { teamId, email } },
        create: { organizationId, teamId, email, createdBy: actor },
        update: {},
      });
    });
    await this.recordAudit("control_plane.team.member_added", actor, teamId, { email });
    return { teamId, email };
  }

  async removeTeamMember(organizationId: string, teamId: string, email: string, actor: string) {
    await this.tenant(organizationId, async (db) => {
      await requireTeam(db, organizationId, teamId);
      await db.cpTeamMember.deleteMany({ where: { organizationId, teamId, email } });
    });
    await this.recordAudit("control_plane.team.member_removed", actor, teamId, { email });
    return { teamId, email, removed: true };
  }

  // ── Project roles ────────────────────────────────────────────────────────

  async listProjectRoles(organizationId: string, projectId: string) {
    return this.tenant(organizationId, async (db) => {
      await requireProject(db, organizationId, projectId);
      return db.cpProjectRoleAssignment.findMany({ where: { organizationId, projectId }, orderBy: { createdAt: "asc" } });
    });
  }

  async setProjectRole(
    organizationId: string,
    projectId: string,
    assignee: { memberEmail: string } | { teamId: string },
    role: ProjectRole,
    actor: string,
  ) {
    const assignment = await this.tenant(organizationId, async (db) => {
      await requireProject(db, organizationId, projectId);
      if ("memberEmail" in assignee) {
        if (!(await roleOf(db, organizationId, assignee.memberEmail))) {
          throw new AppError(`'${assignee.memberEmail}' must be an organization member first`, 409, "NOT_A_MEMBER");
        }
      } else {
        await requireTeam(db, organizationId, assignee.teamId);
      }
      const where = { organizationId, projectId, ...assignee };
      const existing = await db.cpProjectRoleAssignment.findFirst({ where });
      return existing
        ? db.cpProjectRoleAssignment.update({ where: { id: existing.id }, data: { role } })
        : db.cpProjectRoleAssignment.create({ data: { id: prefixedId("pra"), ...where, role, createdBy: actor } });
    });
    await this.recordAudit("control_plane.project_role.set", actor, assignment.id, { projectId, ...assignee, role });
    return assignment;
  }

  async removeProjectRole(organizationId: string, projectId: string, assignmentId: string, actor: string) {
    await this.tenant(organizationId, async (db) => {
      const removed = await db.cpProjectRoleAssignment.deleteMany({ where: { id: assignmentId, organizationId, projectId } });
      if (removed.count === 0) throw new NotFoundError(`Role assignment '${assignmentId}' was not found`);
    });
    await this.recordAudit("control_plane.project_role.removed", actor, assignmentId, { projectId });
    return { id: assignmentId, removed: true };
  }

  /** Makes the creator of a project its administrator. */
  async grantCreatorProjectAdmin(organizationId: string, projectId: string, email: string) {
    await this.tenant(organizationId, (db) =>
      db.cpProjectRoleAssignment.create({
        data: { id: prefixedId("pra"), organizationId, projectId, memberEmail: email, role: "admin", createdBy: email },
      }),
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private tenant<T>(organizationId: string, work: (db: TenantDb) => Promise<T>): Promise<T> {
    return withTenant(this.prisma, { organizationId }, work);
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

async function roleOf(db: TenantDb, organizationId: string, email: string): Promise<OrganizationRole | undefined> {
  const member = await db.organizationMember.findUnique({ where: { organization_members_pkey: { organizationId, email } } });
  return member ? normalizeOrganizationRole(member.role) : undefined;
}

async function assertNotLastOwner(db: TenantDb, organizationId: string) {
  const owners = await db.organizationMember.count({ where: { organizationId, role: "owner", status: "active" } });
  if (owners <= 1) throw new AppError("An organization must keep at least one owner", 409, "LAST_OWNER");
}

async function requireOrganization(db: TenantDb, organizationId: string) {
  if (!(await db.organization.findUnique({ where: { id: organizationId } }))) {
    throw new NotFoundError(`Organization '${organizationId}' was not found`);
  }
}

async function requireTeam(db: TenantDb, organizationId: string, teamId: string) {
  if (!(await db.cpTeam.findFirst({ where: { id: teamId, organizationId } }))) {
    throw new NotFoundError(`Team '${teamId}' was not found`);
  }
}

async function requireProject(db: TenantDb, organizationId: string, projectId: string) {
  if (!(await db.cpProject.findFirst({ where: { id: projectId, organizationId } }))) {
    throw new NotFoundError(`Project '${projectId}' was not found`);
  }
}
