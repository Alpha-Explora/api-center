import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { ConflictError, NotFoundError } from "@shared/errors";
import { isPlatformCapability } from "@shared/platform-capabilities";
import { isOwnerTribeIdRequiredForManifest } from "@shared/service-manifest-governance";
import { ServiceManifest } from "../../../types";
import { RegistryService } from "./registry.service";

type RegistrationRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applied";

type RegistrationRequestRow = {
  id: string;
  serviceId: string;
  ownerTribeId: string;
  status: string;
  manifest: unknown;
  validationReport: unknown;
  requestedBy: string | null;
  approvedBy: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  appliedServiceId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  decidedAt: Date | string | null;
  appliedAt: Date | string | null;
};

export type RegistrationPlanIssue = {
  severity: "info" | "warning" | "blocking";
  code: string;
  serviceId?: string;
  message: string;
};

export type RegistrationValidationReport = {
  canApply: boolean;
  issues: RegistrationPlanIssue[];
};

export type ServiceRegistrationRequest = {
  id: string;
  serviceId: string;
  ownerTribeId: string;
  status: string;
  manifest: ServiceManifest;
  validationReport: RegistrationValidationReport;
  requestedBy?: string;
  approvedBy?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  appliedServiceId?: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  appliedAt?: string;
};

@Injectable()
export class RegistrationRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RegistryService,
  ) {}

  async createRequest(input: {
    manifest: ServiceManifest;
    requestedBy?: string;
  }): Promise<ServiceRegistrationRequest> {
    const manifest = normalizeManifest(input.manifest);
    const ownerTribeId = resolveOwnerTribeId(manifest);
    const validationReport = this.buildValidationReport(manifest, ownerTribeId);
    const row = await this.prisma.registryChangeRequest.create({
      data: {
        serviceId: manifest.serviceId,
        ownerTribeId,
        status: "pending",
        manifest: manifest as any,
        validationReport: validationReport as any,
        requestedBy: input.requestedBy,
      },
    });

    return mapRow(row);
  }

  async listRequests(
    status?: RegistrationRequestStatus,
  ): Promise<ServiceRegistrationRequest[]> {
    const rows = await this.prisma.registryChangeRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
    });

    return rows.map(mapRow);
  }

  async approveRequest(
    requestId: string,
    approvedBy: string,
  ): Promise<ServiceRegistrationRequest> {
    const request = await this.getRequest(requestId);
    if (request.status !== "pending") {
      throw new ConflictError(
        "Only pending registration requests can be approved",
      );
    }

    const validationReport = this.buildValidationReport(
      request.manifest,
      request.ownerTribeId,
    );

    if (!validationReport.canApply) {
      await this.prisma.registryChangeRequest.update({
        where: { id: requestId },
        data: { validationReport: validationReport as any },
      });

      const blockingMessages = validationReport.issues
        .filter((issue) => issue.severity === "blocking")
        .map((issue) => issue.message)
        .join(" ");

      throw new ConflictError(
        `Registration request cannot be approved: ${blockingMessages}`,
      );
    }

    const entry = await this.registry.register(request.manifest);
    const row = await this.prisma.registryChangeRequest.update({
      where: { id: requestId },
      data: {
        status: "applied",
        approvedBy,
        appliedServiceId: entry.serviceId,
        validationReport: validationReport as any,
        decidedAt: new Date(),
        appliedAt: new Date(),
      },
    });

    return mapRow(row);
  }

  async rejectRequest(
    requestId: string,
    rejectedBy: string,
    reason: string,
  ): Promise<ServiceRegistrationRequest> {
    const result = await this.prisma.registryChangeRequest.updateMany({
      where: {
        id: requestId,
        status: "pending",
      },
      data: {
        status: "rejected",
        rejectedBy,
        rejectionReason: reason,
        decidedAt: new Date(),
      },
    });

    if (result.count === 0) {
      throw new ConflictError(
        "Only pending registration requests can be rejected",
      );
    }

    return this.getRequest(requestId);
  }

  private async getRequest(
    requestId: string,
  ): Promise<ServiceRegistrationRequest> {
    const row = await this.prisma.registryChangeRequest.findUnique({
      where: { id: requestId },
    });

    if (!row) {
      throw new NotFoundError(`Registration request '${requestId}' not found`);
    }

    return mapRow(row);
  }

  private buildValidationReport(
    manifest: ServiceManifest,
    ownerTribeId: string,
  ): RegistrationValidationReport {
    const registry = this.registry.getAll();
    const issues: RegistrationPlanIssue[] = [];

    if (isOwnerTribeIdRequiredForManifest(manifest)) {
      issues.push({
        severity: "blocking",
        code: "owner-tribe-required",
        serviceId: manifest.serviceId,
        message: `ownerTribeId is required before '${manifest.serviceId}' can be registered as a tribe microservice.`,
      });
    }

    if (
      (manifest.serviceType ?? "tribe") !== "shared" &&
      ownerTribeId !== manifest.serviceId
    ) {
      const owner = registry[ownerTribeId];
      if (!owner || (owner.serviceType ?? "tribe") !== "tribe") {
        issues.push({
          severity: "blocking",
          code: "owner-tribe-missing",
          serviceId: manifest.serviceId,
          message: `Owner tribe '${ownerTribeId}' must exist before '${manifest.serviceId}' can be registered.`,
        });
      }
    }

    for (const dependency of manifest.consumes ?? []) {
      if (isPlatformCapability(dependency)) {
        continue;
      }

      if (!registry[dependency]) {
        issues.push({
          severity: "warning",
          code: "unknown-consumed-service",
          serviceId: manifest.serviceId,
          message: `'${manifest.serviceId}' consumes '${dependency}', but that service is not registered yet.`,
        });
      }
    }

    return {
      canApply: issues.every((issue) => issue.severity !== "blocking"),
      issues,
    };
  }
}

function normalizeManifest(manifest: ServiceManifest): ServiceManifest {
  return {
    ...manifest,
    consumes: manifest.consumes ?? [],
    serviceType: manifest.serviceType ?? "tribe",
  };
}

function resolveOwnerTribeId(manifest: ServiceManifest): string {
  if ((manifest.serviceType ?? "tribe") === "shared") {
    return manifest.ownerTribeId ?? manifest.serviceId;
  }

  return manifest.ownerTribeId ?? manifest.serviceId;
}

function mapRow(row: RegistrationRequestRow): ServiceRegistrationRequest {
  return {
    id: row.id,
    serviceId: row.serviceId,
    ownerTribeId: row.ownerTribeId,
    status: row.status as RegistrationRequestStatus,
    manifest: parseJsonField<ServiceManifest>(row.manifest),
    validationReport: parseJsonField<RegistrationValidationReport>(
      row.validationReport,
    ),
    requestedBy: row.requestedBy ?? undefined,
    approvedBy: row.approvedBy ?? undefined,
    rejectedBy: row.rejectedBy ?? undefined,
    rejectionReason: row.rejectionReason ?? undefined,
    appliedServiceId: row.appliedServiceId ?? undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    decidedAt: row.decidedAt ? toIsoString(row.decidedAt) : undefined,
    appliedAt: row.appliedAt ? toIsoString(row.appliedAt) : undefined,
  };
}

function parseJsonField<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
