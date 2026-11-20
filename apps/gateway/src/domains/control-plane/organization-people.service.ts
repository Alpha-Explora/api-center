// Organization members, teams and project role assignments.

import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService, type AuditOwner } from "@audit/audit-events.service";
import { ConfigService } from "@config/config.service";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors";
import { normalizeOrganizationRole, type OrganizationRole, type ProjectRole } from "./console-access.policy";
import { consoleAccessCacheFor } from "./console-access-cache";
import { withTenant, type TenantDb } from "./tenant-transaction";
import { assertProjectsKeepAdministrator } from "./project-admin-guard";

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
    @Optional() private readonly config?: ConfigService,
  ) {}

  // ── Members ──────────────────────────────────────────────────────────────

  /**
   * The organizations an email belongs to, across all organizations, for console sign-in. Platform
   * operators (PLATFORM_ADMIN_EMAILS) act in every organization.
   */
  async membershipsOf(email: string) {
    const rows = await this.prisma.organizationMember.findMany({
      where: { email },
      include: { organization: { select: { slug: true, name: true } } },
      orderBy: { organizationId: "asc" },
    });
    const platformAdmin = this.config?.platformAdminEmails.includes(email) ?? false;
    return {
      email,
      platformAdmin,
      memberships: rows.map((row) => ({
        organizationId: row.organizationId,
        organizationSlug: row.organization.slug,
        organizationName: row.organization.name,
        role: normalizeOrganizationRole(row.role) ?? "viewer",
      })),
      // Platform operators act in every organization, so the console offers all of them.
      ...(platformAdmin ? { organizations: await this.activeOrganizations() } : {}),
    };
  }

  private async activeOrganizations() {
    const organizations = await this.prisma.organization.findMany({
      where: { status: "active" },
      select: { id: true, slug: true, name: true },
      orderBy: { name: "asc" },
    });
    return organizations.map((organization) => ({
      organizationId: organization.id,
      organizationSlug: organization.slug,
      organizationName: organization.name,
    }));
  }

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

  /** `mayManageOwners`: whether the actor may make, change or remove an owner. Defaults to yes for internal callers. */
  async setMember(organizationId: string, email: string, role: OrganizationRole, actor: string, options: { mayManageOwners: boolean } = { mayManageOwners: true }) {
    const previous = await this.mutate(organizationId, async (db) => {
      await requireOrganization(db, organizationId);
      const current = await roleOf(db, organizationId, email);
      if ((role === "owner" || current === "owner") && !options.mayManageOwners) throw new ForbiddenError(OWNERS_ONLY);
      if (current === "owner" && role !== "owner") await assertNotLastOwner(db, organizationId);
      await db.organizationMember.upsert({
        where: { organization_members_pkey: { organizationId, email } },
        create: { organizationId, email, role, createdBy: actor },
        update: { role },
      });
      return current;
    });
    await this.recordAudit({ organizationId }, "control_plane.member.set", actor, `${organizationId}:${email}`, { role, previousRole: previous ?? null });
    return { email, role, previousRole: previous ?? null };
  }

  async removeMember(organizationId: string, email: string, actor: string, options: { mayManageOwners: boolean } = { mayManageOwners: true }) {
    const previous = await this.mutate(organizationId, async (db) => {
      const current = await roleOf(db, organizationId, email);
      if (!current) throw new NotFoundError(`'${email}' is not a member`);
      if (current === "owner" && !options.mayManageOwners) throw new ForbiddenError(OWNERS_ONLY);
      if (current === "owner") await assertNotLastOwner(db, organizationId);
      await assertProjectsKeepAdministrator(db, organizationId, { kind: "member", email });
      await db.organizationMember.delete({ where: { organization_members_pkey: { organizationId, email } } });
      return current;
    });
    await this.recordAudit({ organizationId }, "control_plane.member.removed", actor, `${organizationId}:${email}`, { previousRole: previous });
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
    await this.recordAudit({ organizationId }, "control_plane.team.created", actor, team.id, { organizationId, slug: team.slug });
    return { ...team, members: [] as string[] };
  }

  /** Deletes a team with its memberships and project roles, unless a project would lose its last administrator. */
  async deleteTeam(organizationId: string, teamId: string, actor: string) {
    const team = await this.mutate(organizationId, async (db) => {
      const found = await db.cpTeam.findFirst({ where: { id: teamId, organizationId } });
      if (!found) throw new NotFoundError(`Team '${teamId}' was not found`);
      await assertProjectsKeepAdministrator(db, organizationId, { kind: "team", teamId });
      await db.cpProjectRoleAssignment.deleteMany({ where: { organizationId, teamId } });
      await db.cpTeamMember.deleteMany({ where: { organizationId, teamId } });
      await db.cpTeam.delete({ where: { id: teamId } });
      return found;
    });
    await this.recordAudit({ organizationId }, "control_plane.team.deleted", actor, teamId, { slug: team.slug });
    return { id: teamId, deleted: true };
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
    await this.mutate(organizationId, async (db) => {
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
    await this.recordAudit({ organizationId }, "control_plane.team.member_added", actor, teamId, { email });
    return { teamId, email };
  }

  async removeTeamMember(organizationId: string, teamId: string, email: string, actor: string) {
    await this.mutate(organizationId, async (db) => {
      await requireTeam(db, organizationId, teamId);
      await assertProjectsKeepAdministrator(db, organizationId, { kind: "teamMember", teamId, email });
      await db.cpTeamMember.deleteMany({ where: { organizationId, teamId, email } });
    });
    await this.recordAudit({ organizationId }, "control_plane.team.member_removed", actor, teamId, { email });
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
    const assignment = await this.mutate(organizationId, async (db) => {
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
      if (existing?.role === "admin" && role !== "admin") {
        await assertProjectsKeepAdministrator(db, organizationId, { kind: "assignment", assignmentId: existing.id });
      }
      return existing
        ? db.cpProjectRoleAssignment.update({ where: { id: existing.id }, data: { role } })
        : db.cpProjectRoleAssignment.create({ data: { id: prefixedId("pra"), ...where, role, createdBy: actor } });
    });
    await this.recordAudit({ organizationId, projectId }, "control_plane.project_role.set", actor, assignment.id, { projectId, ...assignee, role });
    return assignment;
  }

  async removeProjectRole(organizationId: string, projectId: string, assignmentId: string, actor: string) {
    await this.mutate(organizationId, async (db) => {
      const existing = await db.cpProjectRoleAssignment.findFirst({ where: { id: assignmentId, organizationId, projectId } });
      if (!existing) throw new NotFoundError(`Role assignment '${assignmentId}' was not found`);
      if (existing.role === "admin") await assertProjectsKeepAdministrator(db, organizationId, { kind: "assignment", assignmentId });
      await db.cpProjectRoleAssignment.delete({ where: { id: assignmentId } });
    });
    await this.recordAudit({ organizationId, projectId }, "control_plane.project_role.removed", actor, assignmentId, { projectId });
    return { id: assignmentId, removed: true };
  }

  /** Makes the creator of a project its administrator. */
  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * A change to members, teams or project roles. Changes in one organization run one at a time:
   * "is this the last owner?" and "does every project keep an administrator?" read other rows, and
   * two concurrent demotions could otherwise both pass and leave none.
   */
  private mutate<T>(organizationId: string, work: (db: TenantDb) => Promise<T>): Promise<T> {
    return this.tenant(organizationId, async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cp_people:${organizationId}`}, 0))`;
      return work(db);
    });
  }

  /** Every people change can change someone's console access, so cached access is dropped after each. */
  private async tenant<T>(organizationId: string, work: (db: TenantDb) => Promise<T>): Promise<T> {
    try {
      return await withTenant(this.prisma, { organizationId }, work);
    } finally {
      consoleAccessCacheFor(this.prisma).invalidateOrganization(organizationId);
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

  private async recordAudit(owner: AuditOwner, type: string, actor: string, resourceId: string, payload: Record<string, unknown>) {
    await this.audit.record({
      type,
      organizationId: owner.organizationId,
      projectId: owner.projectId,
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

const OWNERS_ONLY = "Your role does not allow organization owners.manage";

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
