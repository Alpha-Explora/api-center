import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import {
  ServiceEnvironmentManifest,
  ServiceLifecycleStatus,
  ServiceRegistryEntry,
  ServiceRegistryMap,
  ServiceTier,
  ServiceType,
} from "../types";
import { RegistryStore } from "./registry-store.interface";

type ServiceRowWithRegistryRelations = Prisma.ServiceGetPayload<{
  include: {
    environments: true;
    routes: true;
    scopes: true;
    dependencies: {
      include: {
        dependsOnService: true;
      };
    };
  };
}>;

const DEFAULT_ORGANIZATION = {
  slug: "default",
  name: "Default Organization",
};

@Injectable()
export class PostgresRegistryStoreService implements RegistryStore {
  constructor(private readonly prisma: PrismaService) {}

  async loadAll(): Promise<ServiceRegistryMap> {
    const rows = await this.prisma.service.findMany({
      include: {
        environments: true,
        routes: true,
        scopes: true,
        dependencies: {
          include: {
            dependsOnService: true,
          },
        },
      },
    });

    return Object.fromEntries(
      rows.map((row) => [row.serviceId, mapRowToRegistryEntry(row)]),
    );
  }

  async upsert(entry: ServiceRegistryEntry): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.upsert({
        where: { slug: DEFAULT_ORGANIZATION.slug },
        update: {},
        create: DEFAULT_ORGANIZATION,
      });

      const service = await tx.service.upsert({
        where: {
          organization_service_id: {
            organizationId: organization.id,
            serviceId: entry.serviceId,
          },
        },
        update: mapRegistryEntryToServiceUpdate(entry),
        create: {
          organizationId: organization.id,
          ...mapRegistryEntryToServiceCreate(entry),
        },
      });

      await tx.serviceRoute.deleteMany({ where: { serviceId: service.id } });
      await tx.serviceScope.deleteMany({ where: { serviceId: service.id } });
      await tx.serviceDependency.deleteMany({
        where: { serviceId: service.id },
      });

      if (entry.exposes.length > 0) {
        await tx.serviceRoute.createMany({
          data: entry.exposes.map((route) => ({
            serviceId: service.id,
            path: route,
          })),
        });
      }

      if (entry.requiredScopes.length > 0) {
        await tx.serviceScope.createMany({
          data: entry.requiredScopes.map((scope) => ({
            serviceId: service.id,
            scope,
          })),
        });
      }

      if (entry.consumes.length > 0) {
        const dependencies = await Promise.all(
          entry.consumes.map(async (dependency) => {
            const target = await tx.service.findUnique({
              where: {
                organization_service_id: {
                  organizationId: organization.id,
                  serviceId: dependency,
                },
              },
              select: { id: true },
            });

            return {
              serviceId: service.id,
              dependencyType: "consumes",
              required: true,
              ...(target
                ? { dependsOnServiceId: target.id }
                : { dependsOnExternalId: dependency }),
            };
          }),
        );

        await tx.serviceDependency.createMany({ data: dependencies });
      }

      await tx.serviceEnvironment.deleteMany({
        where: { serviceId: service.id },
      });

      const environments = normalizeEnvironmentRows(entry);
      if (environments.length > 0) {
        await tx.serviceEnvironment.createMany({
          data: environments.map((environment) => ({
            serviceId: service.id,
            environment: environment.environment,
            baseUrl: environment.baseUrl,
            healthCheckPath: environment.healthCheck,
            status: environment.status ?? entry.status,
            healthy: environment.healthy,
            lastHealthCheckAt: environment.lastHealthCheckAt
              ? new Date(environment.lastHealthCheckAt)
              : undefined,
            registeredAt: new Date(entry.registeredAt),
            updatedAt: new Date(entry.updatedAt),
          })),
        });
      }

      await tx.serviceLifecycleEvent.create({
        data: {
          serviceId: service.id,
          eventType: "updated",
          nextStatus: entry.status,
          nextVersion: entry.version,
          metadata: {},
        },
      });
    });
  }

  async remove(serviceId: string): Promise<void> {
    await this.prisma.service.updateMany({
      where: { serviceId },
      data: {
        status: "retired",
        updatedAt: new Date(),
      },
    });
  }
}

function mapRegistryEntryToServiceCreate(
  entry: ServiceRegistryEntry,
): Prisma.ServiceUncheckedCreateWithoutOrganizationInput {
  return {
    serviceId: entry.serviceId,
    name: entry.name,
    serviceType: entry.serviceType ?? "tribe",
    baseUrl: entry.baseUrl,
    healthCheckPath: entry.healthCheck,
    status: entry.status,
    version: entry.version,
    previousVersion: entry.previousVersion,
    description: entry.description,
    tags: entry.tags ?? [],
    ownerTribeId: effectiveOwnerTribeId(entry),
    ownerTeam: entry.ownerTeam,
    contact: entry.contact,
    serviceTier: entry.serviceTier,
    costCenter: entry.costCenter,
    sunsetDate: entry.sunsetDate ? new Date(entry.sunsetDate) : undefined,
    replacementServiceId: entry.replacementService,
    healthy: entry.healthy,
    lastHealthCheckAt: entry.lastHealthCheckAt
      ? new Date(entry.lastHealthCheckAt)
      : undefined,
    registeredAt: new Date(entry.registeredAt),
    updatedAt: new Date(entry.updatedAt),
  };
}

function mapRegistryEntryToServiceUpdate(
  entry: ServiceRegistryEntry,
): Prisma.ServiceUncheckedUpdateInput {
  return {
    name: entry.name,
    serviceType: entry.serviceType ?? "tribe",
    baseUrl: entry.baseUrl,
    healthCheckPath: entry.healthCheck,
    status: entry.status,
    version: entry.version,
    previousVersion: entry.previousVersion,
    description: entry.description,
    tags: entry.tags ?? [],
    ownerTribeId: effectiveOwnerTribeId(entry),
    ownerTeam: entry.ownerTeam,
    contact: entry.contact,
    serviceTier: entry.serviceTier,
    costCenter: entry.costCenter,
    sunsetDate: entry.sunsetDate ? new Date(entry.sunsetDate) : null,
    replacementServiceId: entry.replacementService,
    healthy: entry.healthy,
    lastHealthCheckAt: entry.lastHealthCheckAt
      ? new Date(entry.lastHealthCheckAt)
      : null,
    registeredAt: new Date(entry.registeredAt),
    updatedAt: new Date(entry.updatedAt),
  };
}

function mapRowToRegistryEntry(
  row: ServiceRowWithRegistryRelations,
): ServiceRegistryEntry {
  const environments = row.environments ?? [];

  return {
    serviceId: row.serviceId,
    name: row.name,
    baseUrl: row.baseUrl,
    requiredScopes: row.scopes.map((scope) => scope.scope),
    exposes: row.routes.map((route) => route.path),
    consumes: row.dependencies
      .map(
        (dependency) =>
          dependency.dependsOnService?.serviceId ??
          dependency.dependsOnExternalId ??
          "",
      )
      .filter(Boolean),
    serviceType: row.serviceType as ServiceType,
    healthCheck: row.healthCheckPath ?? undefined,
    version: row.version ?? undefined,
    description: row.description ?? undefined,
    tags: Array.isArray(row.tags) ? row.tags.filter(isString) : undefined,
    ownerTribeId: row.ownerTribeId ?? undefined,
    ownerTeam: row.ownerTeam ?? undefined,
    contact: row.contact ?? undefined,
    serviceTier: row.serviceTier as ServiceTier | undefined,
    costCenter: row.costCenter ?? undefined,
    sunsetDate: row.sunsetDate?.toISOString(),
    replacementService: row.replacementServiceId ?? undefined,
    registeredAt: row.registeredAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    status: row.status as ServiceLifecycleStatus,
    previousVersion: row.previousVersion ?? undefined,
    healthy: row.healthy ?? undefined,
    lastHealthCheckAt: row.lastHealthCheckAt?.toISOString(),
    environments:
      environments.length > 0
        ? environments.map((environment) => ({
            environment:
              environment.environment as ServiceEnvironmentManifest["environment"],
            baseUrl: environment.baseUrl,
            healthCheck: environment.healthCheckPath ?? undefined,
            status: environment.status as ServiceLifecycleStatus,
            healthy: environment.healthy ?? undefined,
            lastHealthCheckAt: environment.lastHealthCheckAt?.toISOString(),
          }))
        : [
            {
              environment: "test",
              baseUrl: row.baseUrl,
              healthCheck: row.healthCheckPath ?? undefined,
              status: row.status as ServiceLifecycleStatus,
              healthy: row.healthy ?? undefined,
              lastHealthCheckAt: row.lastHealthCheckAt?.toISOString(),
            },
          ],
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function effectiveOwnerTribeId(
  entry: ServiceRegistryEntry,
): string | undefined {
  if ((entry.serviceType ?? "tribe") === "shared") {
    return entry.ownerTribeId;
  }

  return entry.ownerTribeId ?? entry.serviceId;
}

function normalizeEnvironmentRows(
  entry: ServiceRegistryEntry,
): ServiceEnvironmentManifest[] {
  if (entry.environments?.length) return entry.environments;

  return [
    {
      environment: "test",
      baseUrl: entry.baseUrl,
      healthCheck: entry.healthCheck,
      status: entry.status,
      healthy: entry.healthy,
      lastHealthCheckAt: entry.lastHealthCheckAt,
    },
  ];
}
