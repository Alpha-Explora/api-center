import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ConflictError, NotFoundError } from "../shared/errors";
import { ServiceManifest, ServiceRegistryEntry } from "../types";
import { RegistryService } from "./registry.service";

type RegistrationRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applied";

type RegistrationRequestRow = {
  id: string;
  service_id: string;
  owner_tribe_id: string;
  status: RegistrationRequestStatus;
  manifest: unknown;
  validation_report: unknown;
  requested_by: string | null;
  approved_by: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  applied_service_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  decided_at: Date | string | null;
  applied_at: Date | string | null;
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
  status: RegistrationRequestStatus;
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
    const rows = await this.prisma.$queryRawUnsafe<RegistrationRequestRow[]>(
      `
        insert into api_center_ops.service_registration_requests
          (service_id, owner_tribe_id, status, manifest, validation_report, requested_by)
        values ($1, $2, $3, cast($4 as jsonb), cast($5 as jsonb), $6)
        returning *
      `,
      manifest.serviceId,
      ownerTribeId,
      "pending",
      JSON.stringify(manifest),
      JSON.stringify(validationReport),
      input.requestedBy ?? null,
    );

    return mapRow(rows[0]);
  }

  async listRequests(
    status?: RegistrationRequestStatus,
  ): Promise<ServiceRegistrationRequest[]> {
    const rows = status
      ? await this.prisma.$queryRawUnsafe<RegistrationRequestRow[]>(
          `
            select *
            from api_center_ops.service_registration_requests
            where status = $1
            order by created_at desc
          `,
          status,
        )
      : await this.prisma.$queryRawUnsafe<RegistrationRequestRow[]>(
          `
            select *
            from api_center_ops.service_registration_requests
            order by created_at desc
          `,
        );

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

    const entry = await this.registry.register(request.manifest);
    const rows = await this.prisma.$queryRawUnsafe<RegistrationRequestRow[]>(
      `
        update api_center_ops.service_registration_requests
        set status = 'applied',
            approved_by = $1,
            applied_service_id = $2,
            decided_at = now(),
            applied_at = now(),
            updated_at = now()
        where id = cast($3 as uuid)
        returning *
      `,
      approvedBy,
      entry.serviceId,
      requestId,
    );

    return mapRow(rows[0]);
  }

  async rejectRequest(
    requestId: string,
    rejectedBy: string,
    reason: string,
  ): Promise<ServiceRegistrationRequest> {
    const rows = await this.prisma.$queryRawUnsafe<RegistrationRequestRow[]>(
      `
        update api_center_ops.service_registration_requests
        set status = 'rejected',
            rejected_by = $1,
            rejection_reason = $2,
            decided_at = now(),
            updated_at = now()
        where id = cast($3 as uuid)
          and status = 'pending'
        returning *
      `,
      rejectedBy,
      reason,
      requestId,
    );

    if (!rows[0]) {
      throw new ConflictError("Only pending registration requests can be rejected");
    }

    return mapRow(rows[0]);
  }

  private async getRequest(
    requestId: string,
  ): Promise<ServiceRegistrationRequest> {
    const rows = await this.prisma.$queryRawUnsafe<RegistrationRequestRow[]>(
      `
        select *
        from api_center_ops.service_registration_requests
        where id = cast($1 as uuid)
        limit 1
      `,
      requestId,
    );

    if (!rows[0]) {
      throw new NotFoundError(`Registration request '${requestId}' not found`);
    }

    return mapRow(rows[0]);
  }

  private buildValidationReport(
    manifest: ServiceManifest,
    ownerTribeId: string,
  ): RegistrationValidationReport {
    const registry = this.registry.getAll();
    const issues: RegistrationPlanIssue[] = [];

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
    serviceId: row.service_id,
    ownerTribeId: row.owner_tribe_id,
    status: row.status,
    manifest: parseJsonField<ServiceManifest>(row.manifest),
    validationReport: parseJsonField<RegistrationValidationReport>(
      row.validation_report,
    ),
    requestedBy: row.requested_by ?? undefined,
    approvedBy: row.approved_by ?? undefined,
    rejectedBy: row.rejected_by ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    appliedServiceId: row.applied_service_id ?? undefined,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    decidedAt: row.decided_at ? toIsoString(row.decided_at) : undefined,
    appliedAt: row.applied_at ? toIsoString(row.applied_at) : undefined,
  };
}

function parseJsonField<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
