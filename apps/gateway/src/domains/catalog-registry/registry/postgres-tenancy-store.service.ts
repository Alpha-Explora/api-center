import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import type { Project, TenancySnapshot, TenancyStatus, TenancyStore, Tribe } from "./tenancy.types";

const DEFAULT_ORGANIZATION = { slug: "default", name: "Default Organization" };

@Injectable()
export class PostgresTenancyStoreService implements TenancyStore {
  constructor(private readonly prisma: PrismaService) {}

  async loadAll(): Promise<TenancySnapshot> {
    const [tribes, projects] = await Promise.all([
      this.prisma.tribe.findMany(),
      this.prisma.project.findMany(),
    ]);
    return {
      tribes: tribes.map((row) => ({
        tribeId: row.tribeId,
        name: row.name,
        ...(row.description ? { description: row.description } : {}),
        status: row.status as TenancyStatus,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      projects: projects.map((row) => ({
        projectId: row.projectId,
        tribeId: row.tribeId,
        name: row.name,
        ...(row.description ? { description: row.description } : {}),
        ...(row.costCenter ? { costCenter: row.costCenter } : {}),
        status: row.status as TenancyStatus,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  async upsertTribe(tribe: Tribe): Promise<void> {
    const organization = await this.prisma.organization.upsert({
      where: { slug: DEFAULT_ORGANIZATION.slug },
      update: {},
      create: DEFAULT_ORGANIZATION,
    });
    const data = {
      name: tribe.name,
      description: tribe.description ?? null,
      status: tribe.status,
      updatedAt: new Date(tribe.updatedAt),
    };
    await this.prisma.tribe.upsert({
      where: { tribeId: tribe.tribeId },
      update: data,
      create: {
        tribeId: tribe.tribeId,
        organizationId: organization.id,
        createdAt: new Date(tribe.createdAt),
        ...data,
      },
    });
  }

  async upsertProject(project: Project): Promise<void> {
    const data = {
      name: project.name,
      description: project.description ?? null,
      costCenter: project.costCenter ?? null,
      status: project.status,
      updatedAt: new Date(project.updatedAt),
    };
    await this.prisma.project.upsert({
      where: { projectId: project.projectId },
      update: data,
      create: {
        projectId: project.projectId,
        tribeId: project.tribeId,
        createdAt: new Date(project.createdAt),
        ...data,
      },
    });
  }
}
