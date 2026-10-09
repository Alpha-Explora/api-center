import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@database/prisma.service";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
} from "@shared/errors";
import { PublishServiceSpecDto } from "./service-spec.dto";

const MAX_DOCUMENT_BYTES = 1024 * 1024;

export type ServiceSpecPublisher = {
  serviceId: string;
  projectId: string;
};

@Injectable()
export class ServiceSpecService {
  constructor(private readonly prisma: PrismaService) {}

  async publish(
    serviceIdentity: string,
    actor: string,
    input: PublishServiceSpecDto,
    publisher?: ServiceSpecPublisher,
  ) {
    const bytes = Buffer.byteLength(canonicalJson(input.document), "utf8");
    if (bytes > MAX_DOCUMENT_BYTES) {
      throw new PayloadTooLargeError(
        "Service specification exceeds the 1 MB limit",
      );
    }

    const service = await this.prisma.service.findUnique({
      where: { id: serviceIdentity },
      select: { id: true, serviceId: true, projectId: true },
    });
    if (!service) {
      throw new NotFoundError(`Service '${serviceIdentity}' was not found`);
    }
    if (
      publisher &&
      (service.serviceId !== publisher.serviceId ||
        service.projectId !== publisher.projectId)
    ) {
      throw new ForbiddenError(
        "A service token may publish only for its own service in its authenticated project",
      );
    }

    const serviceUuid = service.id;
    const canonicalDocument = canonicalize(
      input.document,
    ) as Prisma.InputJsonValue;
    const sha256 = createHash("sha256")
      .update(canonicalJson(input.document))
      .digest("hex");
    const byVersion = await this.prisma.serviceSpecVersion.findUnique({
      where: {
        service_spec_versions_service_version_key: {
          serviceId: serviceUuid,
          version: input.version,
        },
      },
    });
    if (byVersion) {
      if (byVersion.sha256 !== sha256) {
        throw new ConflictError(
          "This service specification version is already published with different content",
        );
      }
      return byVersion;
    }

    const byHash = await this.prisma.serviceSpecVersion.findUnique({
      where: {
        service_spec_versions_service_sha256_key: {
          serviceId: serviceUuid,
          sha256,
        },
      },
    });
    if (byHash) return byHash;

    try {
      return await this.prisma.serviceSpecVersion.create({
        data: {
          serviceId: serviceUuid,
          version: input.version,
          format: input.format,
          document: canonicalDocument,
          sha256,
          publishedBy: actor,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const raced = await this.prisma.serviceSpecVersion.findFirst({
          where: {
            serviceId: serviceUuid,
            OR: [{ version: input.version }, { sha256 }],
          },
        });
        if (raced?.sha256 === sha256) return raced;
        throw new ConflictError(
          "This service specification version is already published with different content",
        );
      }
      throw error;
    }
  }

  async list(serviceIdentity: string) {
    const serviceUuid = await this.resolveServiceUuid(serviceIdentity);
    return this.prisma.serviceSpecVersion.findMany({
      where: { serviceId: serviceUuid },
      orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
      select: {
        version: true,
        format: true,
        sha256: true,
        publishedBy: true,
        publishedAt: true,
      },
    });
  }

  async get(serviceIdentity: string, version?: string) {
    const serviceUuid = await this.resolveServiceUuid(serviceIdentity);
    const spec =
      version === undefined
        ? await this.prisma.serviceSpecVersion.findFirst({
            where: { serviceId: serviceUuid },
            orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
          })
        : await this.prisma.serviceSpecVersion.findUnique({
            where: {
              service_spec_versions_service_version_key: {
                serviceId: serviceUuid,
                version,
              },
            },
          });
    if (!spec)
      throw new NotFoundError("Service specification version was not found");
    return spec;
  }

  async listCatalogServices() {
    const services = await this.prisma.service.findMany({
      select: {
        id: true,
        organizationId: true,
        serviceId: true,
        name: true,
        serviceType: true,
        status: true,
        projectId: true,
        ownerTribeId: true,
        ownerTeam: true,
        contact: true,
        serviceTier: true,
        organization: { select: { name: true, slug: true } },
        project: {
          select: {
            name: true,
            tribe: { select: { name: true } },
          },
        },
        scopes: { select: { scope: true } },
        routes: { select: { path: true } },
      },
      orderBy: [{ organizationId: "asc" }, { serviceId: "asc" }],
    });
    return services.map((service) => ({
      id: service.id,
      organizationId: service.organizationId,
      organizationName: service.organization.name,
      organizationSlug: service.organization.slug,
      serviceId: service.serviceId,
      name: service.name,
      serviceType: service.serviceType,
      status: service.status,
      projectId: service.projectId,
      projectName: service.project?.name ?? null,
      ownerTribeId: service.ownerTribeId,
      ownerTribeName: service.project?.tribe.name ?? null,
      ownerTeam: service.ownerTeam,
      contact: service.contact,
      serviceTier: service.serviceTier,
      requiredScopes: service.scopes.map(({ scope }) => scope),
      exposes: service.routes.map(({ path }) => path),
    }));
  }

  private async resolveServiceUuid(serviceIdentity: string) {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceIdentity },
      select: { id: true },
    });
    if (!service) {
      throw new NotFoundError(`Service '${serviceIdentity}' was not found`);
    }
    return service.id;
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
