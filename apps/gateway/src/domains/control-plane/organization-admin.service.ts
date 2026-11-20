// Organizations, administered by platform operators: list with counts, create (optionally with a
// first owner), rename, and suspend or reactivate.
//
// Suspension is enforced elsewhere: capability-access.policy denies every application request of an
// inactive organization (ORGANIZATION_INACTIVE), project creation refuses it, and platform
// operators' organization switcher lists only active organizations.
//
// Suspension stops traffic, not administration, by design: members of a suspended organization keep
// console access and can still change members, keys, quotas and settings (other than creating
// projects), so they can fix whatever led to the suspension before an operator reactivates it.
// Nothing they change takes effect for applications until then.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { AppError, ConflictError, NotFoundError } from "@shared/errors";
import { withTenant, type TenantDb } from "./tenant-transaction";

export type OrganizationStatus = "active" | "suspended";

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: Date;
  projectCount: number;
  memberCount: number;
}

@Injectable()
export class OrganizationAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventsService,
  ) {}

  async list(): Promise<OrganizationSummary[]> {
    return withTenant(this.prisma, "platform", async (db) => {
      const organizations = await db.organization.findMany({ orderBy: { name: "asc" } });
      // Counted in the database: loading every project and member row only to count them grows with the platform.
      const projects = await db.cpProject.groupBy({ by: ["organizationId"], _count: { _all: true } });
      const members = await db.organizationMember.groupBy({ by: ["organizationId"], _count: { _all: true } });
      const projectCounts = new Map(projects.map((row) => [row.organizationId, row._count._all]));
      const memberCounts = new Map(members.map((row) => [row.organizationId, row._count._all]));
      return organizations
        .map((organization) => ({
          id: organization.id,
          slug: organization.slug,
          name: organization.name,
          status: organization.status,
          createdAt: organization.createdAt,
          projectCount: projectCounts.get(organization.id) ?? 0,
          memberCount: memberCounts.get(organization.id) ?? 0,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
    });
  }

  /** Creates an active organization; with an owner email, that person becomes its first owner. */
  async create(input: { name: string; slug: string; ownerEmail?: string }, actor: string) {
    const organization = await this.uniqueSlug(input.slug, () =>
      withTenant(this.prisma, "platform", async (db) => {
        await assertSlugFree(db, input.slug);
        const created = await db.organization.create({ data: { id: randomUUID(), slug: input.slug, name: input.name, status: "active" } });
        if (input.ownerEmail) {
          await db.organizationMember.create({ data: { organizationId: created.id, email: input.ownerEmail, role: "owner", createdBy: actor } });
        }
        return created;
      }),
    );
    await this.recordAudit(organization.id, "control_plane.organization.created", actor, organization.id, {
      slug: organization.slug,
      name: organization.name,
      ownerEmail: input.ownerEmail ?? null,
    });
    if (input.ownerEmail) {
      await this.recordAudit(organization.id, "control_plane.member.set", actor, `${organization.id}:${input.ownerEmail}`, { role: "owner", previousRole: null });
    }
    return view(organization);
  }

  async rename(organizationId: string, input: { name?: string; slug?: string }, actor: string) {
    const { before, after } = await this.uniqueSlug(input.slug ?? "", () =>
      withTenant(this.prisma, "platform", async (db) => {
        const current = await requireOrganization(db, organizationId);
        if (input.slug && input.slug !== current.slug) await assertSlugFree(db, input.slug);
        const updated = await db.organization.update({
          where: { id: organizationId },
          data: { ...(input.name ? { name: input.name } : {}), ...(input.slug ? { slug: input.slug } : {}) },
        });
        return { before: current, after: updated };
      }),
    );
    await this.recordAudit(organizationId, "control_plane.organization.renamed", actor, organizationId, {
      before: { name: before.name, slug: before.slug },
      after: { name: after.name, slug: after.slug },
    });
    return view(after);
  }

  /** Idempotent: setting the current status changes nothing and records nothing. */
  async setStatus(organizationId: string, status: OrganizationStatus, actor: string) {
    const { previous, organization } = await withTenant(this.prisma, "platform", async (db) => {
      const current = await requireOrganization(db, organizationId);
      if (current.status !== "active" && current.status !== "suspended") {
        throw new AppError(`Organization is ${current.status}; only active and suspended organizations can change status`, 409, "ORGANIZATION_STATUS_FIXED");
      }
      if (current.status === status) return { previous: current.status, organization: current };
      return { previous: current.status, organization: await db.organization.update({ where: { id: organizationId }, data: { status } }) };
    });
    if (previous !== status) {
      await this.recordAudit(
        organizationId,
        status === "suspended" ? "control_plane.organization.suspended" : "control_plane.organization.reactivated",
        actor,
        organizationId,
        { previousStatus: previous, status },
        status === "suspended" ? "warning" : "info",
      );
    }
    return view(organization);
  }

  private async uniqueSlug<T>(slug: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError(`Organization slug '${slug}' is already used`);
      }
      throw error;
    }
  }

  private async recordAudit(
    organizationId: string,
    type: string,
    actor: string,
    resourceId: string,
    payload: Record<string, unknown>,
    severity: "info" | "warning" = "info",
  ) {
    await this.audit.record({
      type,
      actionFamily: "registration",
      actor,
      organizationId,
      resourceType: type.split(".")[1],
      resourceId,
      severity,
      message: type.replaceAll(".", " "),
      payload,
    });
  }
}

function view(organization: { id: string; slug: string; name: string; status: string; createdAt: Date }) {
  return { id: organization.id, slug: organization.slug, name: organization.name, status: organization.status, createdAt: organization.createdAt };
}

async function requireOrganization(db: TenantDb, organizationId: string) {
  const organization = await db.organization.findUnique({ where: { id: organizationId } });
  if (!organization) throw new NotFoundError(`Organization '${organizationId}' was not found`);
  return organization;
}

async function assertSlugFree(db: TenantDb, slug: string) {
  if (await db.organization.findUnique({ where: { slug } })) throw new ConflictError(`Organization slug '${slug}' is already used`);
}
