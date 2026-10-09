import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@database/prisma.service";
import {
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
} from "@shared/errors";
import { PublishServiceSpecDto } from "./service-spec.dto";

const MAX_DOCUMENT_BYTES = 1024 * 1024;

@Injectable()
export class ServiceSpecService {
  constructor(private readonly prisma: PrismaService) {}

  async publish(
    serviceId: string,
    actor: string,
    input: PublishServiceSpecDto,
  ) {
    const bytes = Buffer.byteLength(canonicalJson(input.document), "utf8");
    if (bytes > MAX_DOCUMENT_BYTES) {
      throw new PayloadTooLargeError(
        "Service specification exceeds the 1 MB limit",
      );
    }

    const services = await this.prisma.service.findMany({
      where: { serviceId },
      select: { id: true },
      take: 2,
    });
    if (services.length === 0)
      throw new NotFoundError(`Service '${serviceId}' was not found`);
    if (services.length > 1) {
      throw new ConflictError(
        `Service '${serviceId}' is ambiguous; use a unique service identifier`,
      );
    }

    const serviceUuid = services[0].id;
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

  async list(serviceId: string) {
    const serviceUuid = await this.resolveServiceUuid(serviceId);
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

  async get(serviceId: string, version?: string) {
    const serviceUuid = await this.resolveServiceUuid(serviceId);
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

  private async resolveServiceUuid(serviceId: string) {
    const services = await this.prisma.service.findMany({
      where: { serviceId },
      select: { id: true },
      take: 2,
    });
    if (services.length === 0)
      throw new NotFoundError(`Service '${serviceId}' was not found`);
    if (services.length > 1) {
      throw new ConflictError(
        `Service '${serviceId}' is ambiguous; use a unique service identifier`,
      );
    }
    return services[0].id;
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
