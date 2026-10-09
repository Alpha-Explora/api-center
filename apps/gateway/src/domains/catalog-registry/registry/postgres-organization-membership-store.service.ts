import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import type { OrganizationRole } from "@shared/dto/organization-membership.dto";

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
}

export interface OrganizationMemberRow {
  organizationId: string;
  email: string;
  role: OrganizationRole;
  createdBy: string | null;
  createdAt: string;
}

export interface MembershipRow {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  role: OrganizationRole;
}

@Injectable()
export class PostgresOrganizationMembershipStoreService {
  constructor(private readonly prisma: PrismaService) {}

  findOrganization(organizationId: string): Promise<OrganizationSummary | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, slug: true, name: true },
    });
  }

  async listMembers(organizationId: string): Promise<OrganizationMemberRow[]> {
    const rows = await this.prisma.organizationMember.findMany({
      where: { organizationId },
      orderBy: { email: "asc" },
    });
    return rows.map(toMemberRow);
  }

  async findMembershipsByEmail(email: string): Promise<MembershipRow[]> {
    const rows = await this.prisma.organizationMember.findMany({
      where: { email },
      include: { organization: { select: { slug: true, name: true } } },
      orderBy: { organizationId: "asc" },
    });
    return rows.map((row) => ({
      organizationId: row.organizationId,
      organizationSlug: row.organization.slug,
      organizationName: row.organization.name,
      role: row.role as OrganizationRole,
    }));
  }

  /** Creates the membership or changes its role. The original created_by is kept on update. */
  async upsertMember(input: {
    organizationId: string;
    email: string;
    role: OrganizationRole;
    createdBy: string;
  }): Promise<OrganizationMemberRow> {
    const row = await this.prisma.organizationMember.upsert({
      where: {
        organization_members_pkey: { organizationId: input.organizationId, email: input.email },
      },
      update: { role: input.role },
      create: {
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        createdBy: input.createdBy,
      },
    });
    return toMemberRow(row);
  }

  async deleteMember(organizationId: string, email: string): Promise<boolean> {
    const result = await this.prisma.organizationMember.deleteMany({
      where: { organizationId, email },
    });
    return result.count > 0;
  }
}

function toMemberRow(row: {
  organizationId: string;
  email: string;
  role: string;
  createdBy: string | null;
  createdAt: Date;
}): OrganizationMemberRow {
  return {
    organizationId: row.organizationId,
    email: row.email,
    role: row.role as OrganizationRole,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}
